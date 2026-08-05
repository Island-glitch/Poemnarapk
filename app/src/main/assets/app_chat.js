let currentChatTab = 'sessions';
let activeUserPersonaId = null; 
let activeSessionId = null;
let onlineAbortController = null;
let offlineAbortController = null;

// 用于渲染当前对话中双方头像的全局临时变量
let activeSessionCharAvatar = null;
let activeSessionUserAvatar = null;

// 记录当前右键/双击被操作的消息节点 ID
let selectedMsgId = null;
let isMultiSelectMode = false;
// 通话上下文标志：工具栏从通话面板打开时为 true，操作完成后需刷新通话面板而非线上对话
window._callToolbarContext = false;
// 暴露 selectedMsgId 设置接口供通话模块调用
window._setSelectedMsgId = function(id) { selectedMsgId = id; };
window._getSelectedMsgId = function() { return selectedMsgId; };
// 工具栏操作后刷新：通话上下文刷新通话面板，否则刷新线上对话
window._refreshAfterToolbarAction = function() {
  if (window._callToolbarContext && window.callSystem && typeof window.callSystem.refreshCallBubbles === "function") {
    window.callSystem.refreshCallBubbles();
  } else {
    renderDialogMessages();
  }
};

// 专属详情页临时存储的 Blob 头像指针
let detailsCharAvatarBlob = null;
let detailsUserAvatarBlob = null;

function openLocationMap(msgId) {
  db.messages.get(msgId).then(msg => {
    if (!msg) return;
    try {
      const locData = JSON.parse(msg.content);
      showCustomAlert(locData.name || '位置', (locData.coord ? '经纬度: ' + locData.coord : '未提供经纬度') + '\n\n位置信息仅供对话场景参考。');
    } catch(e) {
      showToast("位置信息解析失败");
    }
  });
}

// === 线下功能全局变量 ===
let isOfflineTheater = false;
let activeTheaterId = null;
let activeOfflineSelectedMsgId = null;
let isOfflineMultiSelectMode = false;

// === 自定义弹窗编辑临时变量 ===
let currentEditingMsgId = null;
let isEditingOfflineMsg = false;

function getMessageDisplayDate(msg, sess) {
  if (!sess || sess.timePerceptionToggle !== 0) {
    return new Date(msg.timestamp);
  }
  try {
    const td = JSON.parse(sess.customTimeData);
    const baseDate = new Date(td.year, td.month - 1, td.day, td.hour, td.minute, 0);
    const elapsed = msg.timestamp - (sess.customTimeSavedAt || msg.timestamp);
    return new Date(baseDate.getTime() + elapsed);
  } catch(e) {
    return new Date(msg.timestamp);
  }
}

function getSimulatedNow(sess) {
  if (!sess || sess.timePerceptionToggle !== 0) {
    return new Date();
  }
  try {
    const td = JSON.parse(sess.customTimeData);
    const baseDate = new Date(td.year, td.month - 1, td.day, td.hour, td.minute, 0);
    const elapsed = Date.now() - (sess.customTimeSavedAt || Date.now());
    return new Date(baseDate.getTime() + elapsed);
  } catch(e) {
    return new Date();
  }
}

function formatWeChatTime(date, relativeToDate) {
  const now = relativeToDate || new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const pad = (num) => String(num).padStart(2, '0');
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (targetDate.getTime() === today.getTime()) {
    return timeStr;
  } else if (targetDate.getTime() === yesterday.getTime()) {
    return `昨天 ${timeStr}`;
  } else if (isSameYear) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
  } else {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
  }
}

// 可折叠式 MCP 工具调用卡片动态 HTML 组装器 (支持持久化与历史渲染)
function buildMcpToolCardHtml(msgId, toolData) {
  const cardId = "mcp-card-" + msgId;
  const serverName = toolData.server || "MCP";
  const toolName = toolData.tool || "tool";
  const argsObj = toolData.arguments || {};
  const resData = toolData.result || {};
  const isSuccess = toolData.status !== 'error';

  const statusBadge = isSuccess
    ? `<span class="mcp-tool-status-badge success">已完成</span>`
    : `<span class="mcp-tool-status-badge error">异常/失败</span>`;

  const resTitle = isSuccess ? "[执行结果 Output]" : "[错误反馈 Error]";
  const resContent = typeof resData === 'string' ? resData : JSON.stringify(resData, null, 2);

  return `
    <div class="mcp-tool-card" id="${cardId}">
      <div class="mcp-tool-card-header" onclick="window.toggleMcpToolCardBody('${cardId}')">
        <div class="mcp-tool-card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--primary); flex-shrink:0;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(serverName)}.${escapeHtml(toolName)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${statusBadge}
          <svg class="mcp-tool-card-chevron" id="${cardId}-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="mcp-tool-card-body" id="${cardId}-body" style="display:none;">
        <div style="font-weight:700; margin-bottom:4px; color:var(--text-secondary);">[调用参数 Params]</div>
        <div>${escapeHtml(JSON.stringify(argsObj, null, 2))}</div>
        <div style="font-weight:700; margin-top:8px; margin-bottom:4px; color:var(--text-secondary);">${resTitle}</div>
        <div>${escapeHtml(resContent)}</div>
      </div>
    </div>
  `;
}

window.toggleMcpToolCardBody = function(cardId) {
  const body = document.getElementById(`${cardId}-body`);
  const chevron = document.getElementById(`${cardId}-chevron`);
  if (body) {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (chevron) {
      if (isHidden) chevron.classList.add("expanded");
      else chevron.classList.remove("expanded");
    }
  }
};

// 深度平衡括号 JSON 提取器：彻底解决嵌套对象导致 JSON 截断和 Unexpected non-whitespace 报错
function parseToolCallFromReply(rawReply) {
  if (!rawReply) return null;

  // 1. 尝试匹配标准的 [CALL_TOOL: ...] 或 【CALL_TOOL: ...】 标签
  const tagRegex = /[\[【]CALL_TOOL\s*:\s*/i;
  const match = rawReply.match(tagRegex);
  
  let toolIndex = -1;
  let fullMatchStr = "";
  let jsonPayload = null;

  if (match) {
    toolIndex = match.index;
    const startJsonIndex = toolIndex + match[0].length;
    jsonPayload = extractFirstJsonObject(rawReply.substring(startJsonIndex));
    if (jsonPayload) {
      const jsonEndIndex = startJsonIndex + jsonPayload.rawLength;
      const closingMatch = rawReply.substring(jsonEndIndex).match(/^[\s]*[\]】]/);
      const closingLen = closingMatch ? closingMatch[0].length : 0;
      fullMatchStr = rawReply.substring(toolIndex, jsonEndIndex + closingLen);
    }
  }

  // 2. 托底防错：如果 AI 忘带 [CALL_TOOL:] 裸写 {"server":..., "tool":...}，智能捕获并修复执行
  if (!jsonPayload) {
    const bareJsonRegex = /\{\s*"server"\s*:\s*"[^"]+"\s*,\s*"tool"\s*:/i;
    const bareMatch = rawReply.match(bareJsonRegex);
    if (bareMatch) {
      toolIndex = bareMatch.index;
      jsonPayload = extractFirstJsonObject(rawReply.substring(toolIndex));
      if (jsonPayload) {
        fullMatchStr = rawReply.substring(toolIndex, toolIndex + jsonPayload.rawLength);
      }
    }
  }

  if (jsonPayload && jsonPayload.data) {
    // 强制剥离 AI 脑补凭空伪造的 result 或 status 字段，保证全流程触发真实 MCP 请求
    if (jsonPayload.data.result) delete jsonPayload.data.result;
    if (jsonPayload.data.status) delete jsonPayload.data.status;

    return {
      index: toolIndex,
      fullMatchStr: fullMatchStr,
      payload: jsonPayload.data
    };
  }
  return null;
}

// 逐字扫描匹配平铺大括号，精准解析任意深层嵌套的 JSON 对象 (含换行符自愈与 AI 漏写括号自动修复)
function extractFirstJsonObject(str) {
  let startIndex = str.indexOf('{');
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;
  let lastJsonCharIndex = -1;

  // 辅助解析器：支持自动处理 JSON 字符串中未转义的换行与控制字符
  const tryParseJson = (jsonText) => {
    try {
      return JSON.parse(jsonText);
    } catch(e) {
      try {
        const cleaned = jsonText.replace(/[\u0000-\u001F]+/g, (m) => {
          if (m === '\n') return '\\n';
          if (m === '\r') return '\\r';
          if (m === '\t') return '\\t';
          return '';
        });
        return JSON.parse(cleaned);
      } catch(e2) {
        return null;
      }
    }
  };

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const rawJsonStr = str.substring(startIndex, i + 1);
          const parsedData = tryParseJson(rawJsonStr);
          if (parsedData) {
            return {
              data: parsedData,
              rawLength: (i + 1) - startIndex
            };
          }
        }
      } else if (char === ']' || char === '】') {
        if (depth > 0) {
          lastJsonCharIndex = i;
          break;
        }
      }
    }
  }

  // 容灾自愈：若 AI 在生成超长嵌套 JSON 时漏写了结尾的 } 大括号，自动补齐补全并尝试解析
  if (depth > 0) {
    const targetEnd = lastJsonCharIndex !== -1 ? lastJsonCharIndex : str.length;
    let rawJsonStr = str.substring(startIndex, targetEnd).trim();
    for (let d = 0; d < depth; d++) {
      rawJsonStr += '}';
    }
    const parsedData = tryParseJson(rawJsonStr);
    if (parsedData) {
      return {
        data: parsedData,
        rawLength: targetEnd - startIndex
      };
    }
  }

  return null;
}

// 真正意义上的 API 流式传输 (SSE Stream Reader) 驱动引擎 (支持思考过程自动包裹与单次请求安全 protection)
async function fetchStreamOrJson(baseUrl, api, messagesToSend, signal, onStreamChunk) {
  // TODO (待以后优化解决): 若 API 对象显式指定了 disableStream (如群聊场景)，则强行关闭流式传输
  const isStreamEnabled = !api.disableStream && localStorage.getItem("settings-stream-enabled") === "true";
  const cleanBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const endpoint = cleanBaseUrl.endsWith('/chat/completions') ? cleanBaseUrl : `${cleanBaseUrl}/chat/completions`;

  // 1. 开启流式传输模式
  if (isStreamEnabled) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json, */*",
        "Authorization": `Bearer ${api.key}`
      },
      body: JSON.stringify({
        model: api.model,
        messages: messagesToSend,
        temperature: api.temperature,
        stream: true
      }),
      signal: signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} 错误: ${errText}`);
    }

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let reasoningText = "";
      let contentText = "";

      try {
        while (true) {
          if (signal && signal.aborted) {
            reader.cancel();
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith(":")) continue;
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (dataStr === "[DONE]") break;
              try {
                const parsed = JSON.parse(dataStr);
                const deltaContent = parsed.choices?.[0]?.delta?.content || "";
                const deltaReasoning = parsed.choices?.[0]?.delta?.reasoning_content || parsed.choices?.[0]?.delta?.thinking || "";

                if (deltaReasoning) reasoningText += deltaReasoning;
                if (deltaContent) contentText += deltaContent;

                // 计算当前合成的完整文本
                let fullText = contentText;
                if (reasoningText) {
                  fullText = `<think>\n${reasoningText.trim()}\n</think>\n` + contentText;
                }

                if (onStreamChunk) onStreamChunk(deltaContent || deltaReasoning, fullText);
              } catch(e) {}
            }
          }
        }
      } catch(e) {
        if (e.name === 'AbortError') throw e;
        console.warn("流式读取终止:", e);
      }

      let finalFullText = contentText;
      if (reasoningText && !contentText.includes("<think>")) {
        finalFullText = `<think>\n${reasoningText.trim()}\n</think>\n` + contentText;
      }
      return finalFullText;
    }
  }

  // 2. 普通非流式模式
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, */*",
      "Authorization": `Bearer ${api.key}`
    },
    body: JSON.stringify({
      model: api.model,
      messages: messagesToSend,
      temperature: api.temperature,
      stream: false
    }),
    signal: signal
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status} 错误: ${errText}`);
  }

  const result = await response.json();
  if (!result.choices || result.choices.length === 0) {
    throw new Error("模型服务返回数据异常，Choice 节点为空。");
  }

  const choice = result.choices[0];
  let content = choice.message?.content || choice.text || "";
  const reasoning = choice.message?.reasoning_content || choice.message?.thinking || "";

  if (reasoning && !content.includes("<think>")) {
    content = `<think>\n${reasoning.trim()}\n</think>\n` + content;
  }
  return content;
}

// 括号平衡法提取完整 JSON 对象（支持嵌套数组/对象/字符串内的花括号）
// 从 str 中找到第一个 { 开始，匹配到对应平衡的 } 结束，返回完整 JSON 字符串
function extractBalancedJson(str) {
  if (!str) return null;
  const startIdx = str.indexOf('{');
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return str.substring(startIdx, i + 1);
    }
  }
  return null; // 不平衡，返回 null
}

// 多媒体与特殊指令单步时序解析器 (防止多媒体卡片乱序置顶)
async function processAndRenderSpecialItem(item, userName, activeSessionId) {
  const tokenRaw = item.tokenRaw;
  const contentRaw = item.contentRaw;

  let token = "";
  if (tokenRaw.includes("TRANSFER") || tokenRaw.includes("转账")) {
    token = tokenRaw.includes("RECEIVE") || tokenRaw.includes("收") ? "RECEIVE_TRANSFER" : "TRANSFER";
  } else if (tokenRaw.includes("RED") || tokenRaw.includes("红包")) {
    token = tokenRaw.includes("OPEN") || tokenRaw.includes("拆") || tokenRaw.includes("领") ? "OPEN_RED_ENVELOPE" : "RED_ENVELOPE";
  } else if (tokenRaw.includes("VOICE") || tokenRaw.includes("语音")) {
    token = "VOICE";
  } else if (tokenRaw.includes("IMAGE") || tokenRaw.includes("图片")) {
    token = "IMAGE";
  } else if (tokenRaw.includes("LOCATION") || tokenRaw.includes("位置")) {
    token = "LOCATION";
  } else if (tokenRaw.includes("PAY_FOR_ME") || tokenRaw.includes("代付")) {
    token = "PAY_FOR_ME";
  } else if (tokenRaw.includes("GIFT") || tokenRaw.includes("送礼")) {
    token = "GIFT";
  } else if (tokenRaw.includes("AGREE_PAY") || tokenRaw.includes("同意代付")) {
    token = "AGREE_PAY";
  }

  if (!token) return;

  let amount = 0, duration = 5, remark = "", url = "", voiceText = "...", imageText = "";
  let rawData = {};
  let isJsonParsed = false;
  // 关键修复：用括号平衡法提取完整 JSON 对象，避免非贪婪正则只抓到内层 {} 导致嵌套 JSON 被腰斩
  const jsonMatch = extractBalancedJson(contentRaw);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch);
      rawData = parsed;
      amount = parseFloat(parsed.amount) || 0;
      duration = parseInt(parsed.duration) || 5;
      remark = parsed.remark || "";
      url = parsed.url || "";
      voiceText = parsed.text || parsed.voiceText || "...";
      imageText = parsed.text || parsed.imageText || "";
      isJsonParsed = true;
    } catch(e) {}
  }

  if (!isJsonParsed) {
    const numMatch = contentRaw.match(/[0-9]+(?:\.[0-9]+)?/);
    if (numMatch) {
      const parsedNum = parseFloat(numMatch[0]);
      amount = parsedNum;
      duration = parseInt(parsedNum) || 5;
    }
    let cleanRemark = contentRaw.replace(/[0-9]+(?:\.[0-9]+)?/g, "").replace(/[:：|｜(（)）元秒\s]/g, "").trim();
    remark = cleanRemark;
    voiceText = cleanRemark || "...";
    imageText = cleanRemark;
  }

  try {
    if (token === 'TRANSFER' && amount > 0) {
      const walletData = { amount: amount, status: 'pending', targetName: userName };
      const transMsg = { sessionId: activeSessionId, senderType: 'char', senderId: 0, content: JSON.stringify(walletData), contentType: 'transfer', timestamp: Date.now() };
      transMsg.id = await db.messages.add(transMsg);
      await appendMessageToDOM(transMsg);
    } else if (token === 'RED_ENVELOPE' && amount > 0) {
      const walletData = { amount: amount, status: 'pending', remark: remark || "恭喜发财" };
      const redMsg = { sessionId: activeSessionId, senderType: 'char', senderId: 0, content: JSON.stringify(walletData), contentType: 'red_envelope', timestamp: Date.now() };
      redMsg.id = await db.messages.add(redMsg);
      await appendMessageToDOM(redMsg);
    } else if (token === 'VOICE') {
      const msgData = { duration: duration, text: voiceText };
      const voiceMsg = { sessionId: activeSessionId, senderType: 'char', senderId: 0, content: JSON.stringify(msgData), contentType: 'voice', timestamp: Date.now() };
      voiceMsg.id = await db.messages.add(voiceMsg);
      await appendMessageToDOM(voiceMsg);
    } else if (token === 'IMAGE') {
      // 检查是否开启聊天生图：开启时转接调用生图API，不再显示文字图
      let chatImageGenEnabled = false;
      if (window.imageGenSystem && typeof window.imageGenSystem.getSessionSettings === 'function') {
        try {
          const sessSettings = await window.imageGenSystem.getSessionSettings(activeSessionId);
          if (sessSettings && sessSettings.chatEnabled) chatImageGenEnabled = true;
        } catch(e) {}
      }

      // 取最近一条 AI 文本消息作为上下文（用于推断主题，不能 OOC）
      let aiContextText = imageText || '';
      try {
        const recentMsgs = await db.messages.where('sessionId').equals(Number(activeSessionId)).reverse().limit(8).toArray();
        for (const rm of recentMsgs) {
          if (rm.senderType === 'char' && rm.contentType === 'text' && rm.content) {
            aiContextText = rm.content + (imageText ? ' ' + imageText : '');
            break;
          }
        }
      } catch (e) {}

      if (chatImageGenEnabled) {
        // 开启聊天生图：创建"生成中"状态消息，转接调用生图API生成真实图像
        const msgData = { url: '', text: imageText, generating: true };
        const imageMsg = { sessionId: activeSessionId, senderType: 'char', senderId: 0, content: JSON.stringify(msgData), contentType: 'image', timestamp: Date.now() };
        imageMsg.id = await db.messages.add(imageMsg);
        await appendMessageToDOM(imageMsg);

        window.imageGenSystem.triggerImageGeneration({
          sessionId: activeSessionId,
          scene: 'chat',
          aiText: aiContextText,
          onComplete: async (result) => {
            console.log('[生图回调] 收到结果:', result ? '成功' : '失败/空');
            try {
              let updated;
              if (result) {
                // 生图成功：双存储，url 存压缩缩略图（小图列表用），hdUrl 存高清原图（大图视图用）
                const thumb = (typeof result === 'object' && result.thumb) ? result.thumb : (typeof result === 'string' ? result : '');
                const hd = (typeof result === 'object' && result.hd) ? result.hd : (typeof result === 'string' ? result : '');
                updated = { url: thumb, hdUrl: hd, text: imageText, generated: true };
              } else {
                // 生图失败：兜底显示文字图（保留描述）
                updated = { url: '', text: imageText, generating: false, genFailed: true };
              }
              await db.messages.update(imageMsg.id, { content: JSON.stringify(updated) });
              const updatedMsg = await db.messages.get(imageMsg.id);
              if (updatedMsg) {
                // 在原位置替换 DOM（避免追加到末尾导致下方显示遗留文字图）
                const oldNode = document.querySelector('[data-msg-id="' + imageMsg.id + '"]');
                if (oldNode && oldNode.parentNode) {
                  // 临时创建占位 placeholder，再用 appendMessageToDOM 插入新内容后替换
                  const placeholder = document.createElement('div');
                  oldNode.parentNode.insertBefore(placeholder, oldNode);
                  oldNode.remove();
                  // 临时让 appendMessageToDOM 把内容插入到 placeholder 位置
                  // 简化方案：直接调用 appendMessageToDOM 后把新节点移到 placeholder 前
                  await appendMessageToDOM(updatedMsg);
                  const newNode = document.querySelector('[data-msg-id="' + imageMsg.id + '"]');
                  if (newNode && newNode !== placeholder) {
                    placeholder.parentNode.insertBefore(newNode, placeholder);
                  }
                  placeholder.remove();
                } else {
                  await appendMessageToDOM(updatedMsg);
                }
              }
            } catch (e) {
              console.warn('生图结果写入失败:', e);
            }
          }
        });
      } else {
        // 未开启聊天生图：保持原有文字图逻辑
        const msgData = { url: url, text: imageText };
        const imageMsg = { sessionId: activeSessionId, senderType: 'char', senderId: 0, content: JSON.stringify(msgData), contentType: 'image', timestamp: Date.now() };
        imageMsg.id = await db.messages.add(imageMsg);
        await appendMessageToDOM(imageMsg);
      }
    }
    else if (token === 'LOCATION') {
      const locName = rawData.name || rawData.text || '未知位置';
      const locCoord = rawData.coord || rawData.latlng || '';
      await db.messages.add({
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: 0,
        content: JSON.stringify({ name: locName, coord: locCoord }),
        contentType: 'location',
        timestamp: Date.now()
      }).then(msgId => {
        db.messages.get(msgId).then(msg => { if (msg) appendMessageToDOM(msg); });
      });
    }
    else if (token === 'PAY_FOR_ME') {
      // AI requests user to pay for them - creates a pending payment request card
      const orderData = rawData.order || rawData.items || [];
      const totalAmount = rawData.amount || rawData.total || 0;
      const message = rawData.message || rawData.remark || '';
      await db.messages.add({
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: 0,
        content: JSON.stringify({ items: orderData, total: totalAmount, message, status: 'pending' }),
        contentType: 'pay_for_me',
        timestamp: Date.now()
      }).then(msgId => {
        db.messages.get(msgId).then(msg => { if (msg) appendMessageToDOM(msg); });
      });
    }
    else if (token === 'GIFT') {
      // AI sends a gift to user
      const giftItems = rawData.items || rawData.order || [];
      const totalAmount = rawData.amount || rawData.total || 0;
      const message = rawData.message || rawData.remark || '送给你的一份心意';
      await db.messages.add({
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: 0,
        content: JSON.stringify({ items: giftItems, total: totalAmount, message, status: 'gift' }),
        contentType: 'gift',
        timestamp: Date.now()
      }).then(msgId => {
        db.messages.get(msgId).then(msg => { if (msg) appendMessageToDOM(msg); });
      });
    }
    else if (token === 'AGREE_PAY') {
      // AI 同意为本用户的代付请求付款：
      // 1) 把代付卡片消息置为已付款；
      // 2) 同步把对应订单状态从 pending_payment → unshipped；
      // 3) 把这笔支出记入我的钱包账单（之前 pending_payment 时未记账，现在代付成功视为一笔支出）。
      const pendingPayForMe = await db.messages
        .where('sessionId').equals(activeSessionId)
        .filter(m => m.contentType === 'pay_for_me')
        .toArray();
      if (pendingPayForMe.length > 0) {
        const latest = pendingPayForMe[pendingPayForMe.length - 1];
        try {
          const data = JSON.parse(latest.content);
          data.status = 'paid';
          await db.messages.update(latest.id, { content: JSON.stringify(data) });

          // 同步更新订单状态：找到该 orderNo 对应的 pending_payment 订单
          if (data.orderNo && db.shopping_orders) {
            const ord = await db.shopping_orders
              .where('orderNo').equals(data.orderNo)
              .first();
            if (ord && ord.status === 'pending_payment') {
              await db.shopping_orders.update(ord.id, {
                status: 'unshipped',
                paidAt: Date.now(),
                paidBy: 'other'
              });

              // 把"我付"应记的购物支出补登进我的钱包账单
              try {
                if (typeof addLedgerEntry === 'function') {
                  const itemDesc = (ord.items && ord.items.length === 1)
                    ? ord.items[0].name
                    : (ord.type === 'food' ? '外卖订单(代付)' : '购物订单(代付)');
                  addLedgerEntry('购物·' + itemDesc + '(对方代付)', ord.total, 'expense');
                }
              } catch(e) { console.warn('代付记账失败', e); }
            }
          }

          showToast("对方已同意代付，订单已付款");
          // 关键修复：用 true 触发 isRefresh 路径，重载已加载消息并保持滚动位置，
          // 之前传 false 会走"向上加载更多"分支导致弹到顶部且不刷新已付款状态
          if (typeof renderDialogMessages === 'function') renderDialogMessages(true);
        } catch(e) { console.error('AGREE_PAY 处理失败', e); }
      }
    }
  } catch(e) {
    console.error("处理单步多媒体消息失败:", e);
  }
}

// 提取并剥离文本中的思维链 (支持动态正则及防掉格式多模态解析)
function parseThoughtFromText(text) {
  if (!text) return { thought: "", cleanText: "" };

  if (window.cotSystem && typeof window.cotSystem.parseThoughtWithRegex === 'function') {
    return window.cotSystem.parseThoughtWithRegex(text);
  }
  
  const thinkRegex = /(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)([\s\S]*?)(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|$)/i;
  const match = text.match(thinkRegex);
  
  if (match) {
    const thought = match[1].trim();
    const cleanText = text.replace(match[0], "").trim();
    return { thought, cleanText };
  }
  return { thought: "", cleanText: text };
}

// 构建渲染可折叠思维链 (CoT) 卡片 HTML
function buildCotThoughtCardHtml(cardId, thoughtText) {
  return `
    <div class="cot-thought-card" id="${cardId}">
      <div class="cot-thought-card-header" onclick="window.toggleCotCardBody('${cardId}')">
        <div class="cot-thought-card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
          <span>深度思考过程 (已折叠)</span>
        </div>
        <svg class="mcp-tool-card-chevron" id="${cardId}-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="cot-thought-card-body" id="${cardId}-body" style="display:none;">
        ${escapeHtml(thoughtText)}
      </div>
    </div>
  `;
}

window.toggleCotCardBody = function(cardId) {
  const body = document.getElementById(`${cardId}-body`);
  const chevron = document.getElementById(`${cardId}-chevron`);
  if (body) {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (chevron) {
      if (isHidden) chevron.classList.add("expanded");
      else chevron.classList.remove("expanded");
    }
  }
};

function openCustomEditModal(msgId, content, isOffline) {
  currentEditingMsgId = msgId;
  isEditingOfflineMsg = isOffline;
  const overlay = document.getElementById("custom-edit-overlay");
  const textarea = document.getElementById("custom-edit-textarea");
  if (overlay && textarea) {
    // 编辑时剥离旧思维链 <think>...</think>，只编辑纯净正文
    let cleanContent = content || "";
    if (typeof cleanContent === 'string') {
      cleanContent = cleanContent.replace(/(?:<think>|\[THINKING\])[\s\S]*?(?:<\/think>|\[\/THINKING\])/gi, "").trim();
    }
    textarea.value = cleanContent;
    overlay.classList.add("active");
    setTimeout(() => textarea.focus(), 50);
  }
}

function closeCustomEditModal() {
  const overlay = document.getElementById("custom-edit-overlay");
  if (overlay) {
    overlay.classList.remove("active");
  }
  currentEditingMsgId = null;
}

// === 核心修复：添加初始化绑定保护锁，100% 杜绝二次加载事件死锁与卡顿 ===
let isChatAppInitialized = false;
let isContextMenuInitialized = false;
let isOfflineContextMenuInitialized = false;
let isChatAppEventsBound = false;
let isOfflineChatAppEventsBound = false;

// 主动注入语音、多媒体场景卡片及群聊专属面板的 CSS 规范样式
          (function() {
            const multimediaStyle = document.createElement("style");
            multimediaStyle.textContent = `
              /* 群聊专属：展示在气泡左上角的发信人姓名 */
              .group-sender-name {
                font-size: 11px;
                color: #7f7f7f;
                margin-bottom: 2px;
                font-weight: 700;
                max-width: 140px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                user-select: none;
                -webkit-user-select: none;
              }
              .msg-bubble.self .group-sender-name {
                text-align: right;
                align-self: flex-end;
              }
              .msg-bubble.other .group-sender-name {
                text-align: left;
                align-self: flex-start;
              }

              /* 修复群聊气泡列包装，防止子选择器样式丢失与挤压腰斩问题 */
              .group-msg-wrapper {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                max-width: 100%;
              }
              .group-msg-wrapper .msg-text {
                width: fit-content;
                max-width: 100%;
                flex-shrink: 0;
                word-break: break-all;
              }

      /* 置顶群公告卡片 */
      .group-announcement-sticky-bar {
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-bottom: 1.5px solid var(--border);
        padding: 8px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: absolute;
        top: 50px;
        left: 0;
        width: 100%;
        box-sizing: border-box;
        z-index: 100;
        animation: slideDown 0.2s ease-out;
      }
      .group-announcement-content-area {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .group-announcement-title {
        font-size: 12px;
        font-weight: 800;
        color: #ef4444;
      }
      .group-announcement-text {
        font-size: 11.5px;
        color: #475569;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .btn-group-announcement-done {
        padding: 4px 10px;
        background: #07c160;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        margin-left: 12px;
      }

      /* 投票卡片 UI 渲染 */
      .group-poll-card {
        background: #ffffff;
        border: 1.5px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        width: 220px;
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .group-poll-card-title {
        font-size: 13px;
        font-weight: 800;
        color: #1e293b;
        border-bottom: 1px dashed var(--border);
        padding-bottom: 6px;
      }
      .group-poll-option-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid var(--border);
        cursor: pointer;
        transition: background 0.15s;
      }
      .group-poll-option-row:hover {
        background: #f1f5f9;
      }
      .group-poll-option-header {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        font-weight: 700;
        color: #334155;
      }
      .group-poll-progressbar {
        height: 6px;
        background: #e2e8f0;
        border-radius: 3px;
        overflow: hidden;
      }
      .group-poll-progressbar-fill {
        height: 100%;
        background: var(--primary);
        width: 0%;
        transition: width 0.3s ease;
      }
    /* 微信语音消息气泡 */
    .voice-bubble-card {
      background-color: #ffffff;
      padding: 10px 14px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      min-width: 70px;
      gap: 12px;
      user-select: none;
    }
    .msg-bubble.self .voice-bubble-card {
      background-color: #95ec69;
      flex-direction: row-reverse;
    }
    .voice-bubble-wave {
      display: flex;
      align-items: center;
      color: #191919;
    }
    .voice-bubble-duration {
      font-size: 13px;
      color: #7f7f7f;
      font-weight: 600;
    }
    .msg-bubble.self .voice-bubble-duration {
      color: #333333;
    }
    .voice-translation-text {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 6px;
      font-size: 13px;
      color: var(--text-primary);
      width: 100%;
      max-width: 220px;
      word-break: break-all;
      box-shadow: var(--shadow-sm);
      animation: fadeIn 0.2s ease-out;
    }
    
    /* 灰色色块画面卡片重隔 */
    .msg-image-placeholder-card {
      background-color: #f3f4f6;
      padding: 12px 14px;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      width: 220px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      user-select: none;
      border: 1px solid var(--border);
    }
    .msg-bubble.self .msg-image-placeholder-card {
      background-color: #95ec69;
    }
    .msg-image-placeholder-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .msg-image-placeholder-title {
      font-size: 13px;
      font-weight: 700;
      color: #191919;
    }
    .msg-image-placeholder-sub {
      font-size: 11px;
      color: #7f7f7f;
    }
    .msg-bubble.self .msg-image-placeholder-sub {
      color: #333333;
    }
    .msg-image-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #f1f5f9;
      padding: 12px;
      border-radius: 6px;
      width: 150px;
      height: 150px;
      flex-direction: column;
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }
    .msg-image-placeholder-card .image-description-text {
      background: #ffffff;
      border: 1.5px dashed var(--border);
      border-radius: 6px;
      padding: 10px;
      font-size: 12px;
      color: #191919;
      line-height: 1.5;
      word-break: break-all;
      animation: fadeIn 0.2s ease-out;
    }
    .msg-bubble.self .msg-image-placeholder-card .image-description-text {
      background: #ffffff;
    }
    
    /* 表情反应面板与贴纸样式 */
    .bubble-emoji-picker {
      animation: scaleIn 0.15s ease-out;
      scrollbar-width: none;
    }
    .bubble-emoji-picker::-webkit-scrollbar {
      display: none;
    }
    .bubble-attached-emoji {
      position: absolute;
      font-size: 15px;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 50%;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1.5px 3px rgba(0,0,0,0.12);
      user-select: none;
      -webkit-user-select: none;
      animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 12;
      cursor: pointer;
    }
    .msg-bubble.self .bubble-attached-emoji {
      bottom: -8px;
      left: -8px;
    }
    .msg-bubble.other .bubble-attached-emoji {
      bottom: -8px;
      right: -8px;
    }
    @keyframes scaleIn {
      from { transform: scale(0.8) translateY(8px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }
    @keyframes popIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }

    /* 折叠式思维链 (CoT) 思考卡片样式 (无 Emoji 矢量版) */
    .cot-thought-card {
      background: #f8fafc;
      border: 1px dashed var(--border);
      border-radius: 10px;
      margin: 6px auto;
      padding: 8px 12px;
      font-size: 11.5px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 90%;
      max-width: 320px;
      box-sizing: border-box;
      animation: fadeIn 0.2s ease-out;
    }
    .cot-thought-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .cot-thought-card-title {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 700;
      color: #64748b;
    }
    .cot-thought-card-body {
      border-top: 1px dashed var(--border);
      padding-top: 6px;
      font-size: 11px;
      color: #475569;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }

    /* 折叠式 MCP 工具调用卡片样式 (无 Emoji 矢量版) */
    .mcp-tool-card {
      background: #ffffff;
      border: 1.5px solid var(--border);
      border-radius: 12px;
      margin: 10px auto;
      padding: 10px 14px;
      font-size: 12px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 90%;
      max-width: 320px;
      box-sizing: border-box;
      animation: fadeIn 0.2s ease-out;
    }
    .mcp-tool-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .mcp-tool-card-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: var(--text-primary);
      overflow: hidden;
    }
    .mcp-tool-status-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .mcp-tool-status-badge.running {
      background: #fef3c7;
      color: #b45309;
    }
    .mcp-tool-status-badge.success {
      background: #dcfce7;
      color: #15803d;
    }
    .mcp-tool-status-badge.error {
      background: #fee2e2;
      color: #b91c1c;
    }
    .mcp-tool-card-body {
      border-top: 1px dashed var(--border);
      padding-top: 8px;
      font-family: monospace;
      font-size: 11px;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 180px;
      overflow-y: auto;
      background: #f8fafc;
      padding: 8px;
      border-radius: 8px;
    }
    .mcp-tool-card-chevron {
      transition: transform 0.2s ease;
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .mcp-tool-card-chevron.expanded {
      transform: rotate(180deg);
    }

    /* 气泡长按选中缩小动效 */
    .msg-bubble {
      transition: transform 0.15s cubic-bezier(0.2, 0, 0.2, 1);
    }
    .msg-bubble.bubble-longpressing {
      transform: scale(0.95);
    }

    /* 全局 PWA 自定义提示与卡片式弹窗 */
    .pwa-toast {
      position: fixed;
      bottom: 120px;
      left: 50%;
      transform: translate(-50%, 20px);
      background: rgba(0, 0, 0, 0.8);
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 20px;
      font-size: 13px;
      z-index: 100001;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      max-width: 80%;
      line-height: 1.4;
    }
    .pwa-toast.show {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    .pwa-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .pwa-modal-overlay.show {
      opacity: 1;
    }
    .pwa-modal-card {
      background: #ffffff;
      width: 290px;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      text-align: center;
      transform: scale(0.9);
      transition: transform 0.2s ease;
      box-sizing: border-box;
    }
    .pwa-modal-overlay.show .pwa-modal-card {
      transform: scale(1);
    }
    .pwa-modal-title {
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }
    .pwa-modal-message {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 16px;
      line-height: 1.5;
      word-break: break-all;
    }
    .pwa-modal-input {
      width: 100%;
      height: 40px;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 0 10px;
      font-size: 15px;
      font-weight: 700;
      outline: none;
      margin-bottom: 16px;
      box-sizing: border-box;
      text-align: center;
    }
    .pwa-modal-buttons {
      display: flex;
      gap: 10px;
    }
    .btn-pwa-modal {
      flex: 1;
      height: 38px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-pwa-modal.cancel {
      background: #f1f5f9;
      color: #64748b;
    }
    .btn-pwa-modal.confirm {
      background: #07c160;
      color: #ffffff;
    }
  `;
  document.head.appendChild(multimediaStyle);

  // 全局注册 PWA Toast 和 Modal 接口
  window.showToast = function(msg, duration = 3000) {
    let toast = document.querySelector(".pwa-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "pwa-toast";
      document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.classList.add("show");
    if (window.toastTimer) clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  };

  window.showCustomAlert = function(title, message, callback) {
    const overlay = document.createElement("div");
    overlay.className = "pwa-modal-overlay";
    overlay.innerHTML = '<div class="pwa-modal-card">' +
      '<div class="pwa-modal-title">' + escapeHtml(title) + '</div>' +
      '<div class="pwa-modal-message">' + escapeHtml(message) + '</div>' +
      '<div class="pwa-modal-buttons">' +
        '<button class="btn-pwa-modal confirm">确定</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    
    setTimeout(() => overlay.classList.add("show"), 10);
    
    overlay.querySelector(".confirm").onclick = () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (typeof callback === 'function') callback();
      }, 200);
    };
  };

  // 全局 HTML 弹窗渲染接口，解决嵌套已读列表 HTML 代码被转译展示的 BUG
  window.showCustomHtmlAlert = function(title, htmlContent, callback) {
    const overlay = document.createElement("div");
    overlay.className = "pwa-modal-overlay";
    overlay.innerHTML = '<div class="pwa-modal-card" style="width: 320px; max-width: 90%;">' +
      '<div class="pwa-modal-title">' + escapeHtml(title) + '</div>' +
      '<div class="pwa-modal-message" style="text-align: left; max-height: 240px; overflow-y: auto;">' + htmlContent + '</div>' +
      '<div class="pwa-modal-buttons" style="margin-top: 16px;">' +
        '<button class="btn-pwa-modal confirm">确定</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    
    setTimeout(() => overlay.classList.add("show"), 10);
    
    overlay.querySelector(".confirm").onclick = () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (typeof callback === 'function') callback();
      }, 200);
    };
  };

  window.showCustomPrompt = function(title, defaultValue, callback) {
    const overlay = document.createElement("div");
    overlay.className = "pwa-modal-overlay";
    overlay.innerHTML = '<div class="pwa-modal-card" style="width: 320px;">' +
      '<div class="pwa-modal-title">' + escapeHtml(title) + '</div>' +
      '<textarea class="pwa-modal-input" style="width: 100%; height: 110px; padding: 10px; border-radius: 8px; border: 1.5px solid var(--border); font-size: 13px; resize: none; outline: none; margin-bottom: 16px; box-sizing: border-box; font-family: inherit; line-height: 1.4;">' + escapeHtml(defaultValue) + '</textarea>' +
      '<div class="pwa-modal-buttons">' +
        '<button class="btn-pwa-modal cancel">取消</button>' +
        '<button class="btn-pwa-modal confirm">确定</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);

    const input = overlay.querySelector(".pwa-modal-input");
    input.focus();
    input.select();
    
    setTimeout(() => overlay.classList.add("show"), 10);
    
    overlay.querySelector(".cancel").onclick = () => {
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 200);
    };
    
    overlay.querySelector(".confirm").onclick = () => {
      const val = input.value;
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (typeof callback === 'function') callback(val);
      }, 200);
    };
  };

  window.showCustomConfirm = function(title, message, onConfirm, onCancel) {
    const overlay = document.createElement("div");
    overlay.className = "pwa-modal-overlay";
    overlay.innerHTML = '<div class="pwa-modal-card">' +
      '<div class="pwa-modal-title">' + escapeHtml(title) + '</div>' +
      '<div class="pwa-modal-message">' + escapeHtml(message) + '</div>' +
      '<div class="pwa-modal-buttons">' +
        '<button class="btn-pwa-modal cancel">取消</button>' +
        '<button class="btn-pwa-modal confirm">确定</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    
    setTimeout(() => overlay.classList.add("show"), 10);
    
    overlay.querySelector(".cancel").onclick = () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (typeof onCancel === 'function') onCancel();
      }, 200);
    };
    
    overlay.querySelector(".confirm").onclick = () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
      }, 200);
    };
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }
})();

function resolveAvatar(avatar) {
  if (!avatar) {
    // 关键修复：SVG 内部属性必须用单引号，否则双引号会提前闭合 <img src="..."> 的 src 属性，
    // 导致头像显示为破损图片，且剩余 SVG 标记（含 > 字符）泄漏到页面，造成名字带残破 > 字样
    return "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='%23cbd5e1'/><text x='50' y='62' font-size='50' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif'>人</text></svg>";
  }
  if (avatar instanceof Blob) {
    return URL.createObjectURL(avatar);
  }
  return avatar;
}

// 头像加载失败兜底：网络 URL 头像失效时回退到默认 SVG，杜绝破图
// 用法：<img src="..." onerror="avatarFallback(this)">
function avatarFallback(img) {
  if (!img || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = '1';
  img.src = "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='%23cbd5e1'/><text x='50' y='62' font-size='50' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif'>人</text></svg>";
  img.onerror = null;
}
window.avatarFallback = avatarFallback;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

// 位置卡片富化渲染：地图底纹 + 经纬线网格 + 建筑物 SVG 图标 + 定位针 + 坐标条
function buildLocationCardHtml(locData, msgId) {
  const name = locData.name || '未知位置';
  const coord = locData.coord || '';
  // 解析经纬度（支持 "lat,lng" 格式）
  let latStr = '', lngStr = '';
  if (coord) {
    const parts = coord.split(/[,，\s]+/);
    if (parts.length >= 2) {
      latStr = parts[0].trim();
      lngStr = parts[1].trim();
    } else {
      latStr = coord;
    }
  }
  const coordDisplay = coord ? `${escapeHtml(coord)}` : '';
  // 根据名称首字 hash 决定建筑图标布局种子，制造细微差异
  const seed = (name.charCodeAt(0) || 65) % 4;
  const buildingLayouts = [
    // 布局0：高楼+矮楼
    `<rect x="20" y="38" width="14" height="22" rx="1" fill="#90a4ae" opacity="0.85"/><rect x="36" y="44" width="10" height="16" rx="1" fill="#78909c" opacity="0.8"/><rect x="48" y="34" width="12" height="26" rx="1" fill="#b0bec5" opacity="0.85"/><rect x="62" y="46" width="9" height="14" rx="1" fill="#90a4ae" opacity="0.75"/>`,
    // 布局1：商场+塔楼
    `<rect x="18" y="42" width="20" height="18" rx="1" fill="#90a4ae" opacity="0.85"/><polygon points="44,38 50,30 56,38 56,60 44,60" fill="#78909c" opacity="0.8"/><rect x="58" y="40" width="14" height="20" rx="1" fill="#b0bec5" opacity="0.85"/>`,
    // 布局2：住宅区
    `<rect x="20" y="44" width="11" height="16" rx="1" fill="#90a4ae" opacity="0.8"/><rect x="33" y="40" width="11" height="20" rx="1" fill="#b0bec5" opacity="0.85"/><rect x="46" y="46" width="11" height="14" rx="1" fill="#78909c" opacity="0.75"/><rect x="59" y="42" width="11" height="18" rx="1" fill="#90a4ae" opacity="0.8"/>`,
    // 布局3：地标+公园
    `<circle cx="30" cy="48" r="8" fill="#a5d6a7" opacity="0.8"/><rect x="44" y="34" width="10" height="26" rx="1" fill="#b0bec5" opacity="0.85"/><polygon points="49,28 54,34 44,34" fill="#78909c" opacity="0.9"/><rect x="58" y="44" width="12" height="16" rx="1" fill="#90a4ae" opacity="0.8"/>`
  ];
  const buildings = buildingLayouts[seed] || buildingLayouts[0];

  return `
    <div class="location-bubble-card" onclick="openLocationMap(${msgId})" style="width:220px; border-radius:10px; overflow:hidden; background:#fff; border:1px solid #e2e8f0; cursor:pointer;">
      <div style="height:110px; background:linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 25%, #bbdefb 55%, #c5cae9 100%); position:relative; overflow:hidden;">
        <svg viewBox="0 0 80 80" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style="position:absolute; bottom:0; left:0;">
          <defs>
            <pattern id="locgrid${msgId}" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(30,136,229,0.12)" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect width="80" height="80" fill="url(#locgrid${msgId})"/>
          <line x1="0" y1="40" x2="80" y2="40" stroke="rgba(30,136,229,0.18)" stroke-width="0.6" stroke-dasharray="3,2"/>
          <line x1="40" y1="0" x2="40" y2="80" stroke="rgba(30,136,229,0.18)" stroke-width="0.6" stroke-dasharray="3,2"/>
          ${buildings}
          <path d="M0,60 Q20,56 40,60 T80,60 L80,80 L0,80 Z" fill="#c8e6c9" opacity="0.5"/>
        </svg>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="#e53935" stroke="#fff" stroke-width="1.5" style="position:absolute; top:40%; left:50%; transform:translate(-50%,-100%); filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>
        <div style="position:absolute; top:5px; right:5px; background:rgba(255,255,255,0.9); padding:2px 6px; border-radius:4px; font-size:9px; color:#1e88e5; font-weight:600;">📍地图</div>
        <div style="position:absolute; bottom:4px; left:6px; background:rgba(0,0,0,0.45); padding:2px 6px; border-radius:3px; font-size:8px; color:#fff; font-family:monospace;">${latStr && lngStr ? `N${escapeHtml(latStr)}° E${escapeHtml(lngStr)}°` : ''}</div>
      </div>
      <div style="padding:8px 10px;">
        <div style="font-size:13px; font-weight:600; color:#333; display:flex; align-items:center; gap:4px;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#e53935" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escapeHtml(name)}
        </div>
        ${coordDisplay ? `<div style="font-size:9.5px; color:#999; margin-top:3px; font-family:monospace;">${coordDisplay}</div>` : ''}
        <div style="font-size:11px; color:#1e88e5; margin-top:4px; display:flex; align-items:center; gap:3px;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          查看位置
        </div>
      </div>
    </div>
  `;
}

// 社交动作跳转卡片构建器：char 发了朋友圈/论坛帖后，系统消息以可点击卡片形式呈现
function buildSocialNoticeCard(data) {
  const wrap = document.createElement("div");
  wrap.className = "group-system-notice-container";
  wrap.style.cssText = "display: flex; justify-content: center; align-items: center; width: 100%; margin: 8px 0; box-sizing: border-box; padding: 0 16px;";

  let iconSvg = "";
  let label = "";
  let subLabel = "";

  if (data.type === 'moment') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#576b95" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
    label = `${data.charName} 发了一条朋友圈`;
    subLabel = data.summary ? escapeHtml(data.summary) : "点击查看";
  } else if (data.type === 'forum_post') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#576b95" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    label = `${data.charName} 在论坛发了帖子`;
    subLabel = `《${escapeHtml(data.title)}》 · @${escapeHtml(data.username)}`;
  } else if (data.type === 'forum_alt_create') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#576b95" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
    label = `${data.charName} 建立了一个论坛小号`;
    subLabel = `@${escapeHtml(data.username)}（${escapeHtml(data.nickname)}）`;
  } else {
    label = escapeHtml(data.label || JSON.stringify(data));
  }

  const hasJump = data.type === 'moment' || data.type === 'forum_post';
  wrap.innerHTML = `
    <div style="background-color: rgba(0,0,0,0.05); padding: 8px 14px; border-radius: 8px; font-size: 11.5px; color: #7f7f7f; max-width: 85%; text-align: center; line-height: 1.5; cursor: ${hasJump ? 'pointer' : 'default'}; ${hasJump ? 'transition: background 0.15s;' : ''}" ${hasJump ? `onclick="window.openSocialNotice('${data.type}', ${data.targetId})"` : ''}>
      <div style="display: flex; align-items: center; justify-content: center; gap: 5px;">
        ${iconSvg}
        <span style="font-weight: 600; color: #576b95;">${label}</span>
      </div>
      ${subLabel ? `<div style="margin-top: 3px; font-size: 11px; color: #999;">${subLabel}${hasJump ? ' · 点击查看' : ''}</div>` : ''}
    </div>
  `;
  return wrap;
}

// 社交动作跳转：点击系统消息卡片跳转到对应的朋友圈动态/论坛帖子
window.openSocialNotice = function(type, targetId) {
  if (type === 'moment') {
    if (typeof window.openMomentFromShare === 'function') {
      window.openMomentFromShare(targetId);
    }
  } else if (type === 'forum_post') {
    // 关闭单聊对话气泡 + 关闭整个 chat 应用窗口，否则论坛层会被 chat 应用盖住看不到
    if (typeof closeChatDialog === 'function') closeChatDialog();
    if (typeof closeApp === 'function') closeApp('chat');
    if (typeof openApp === 'function') openApp('forum');
    // 延迟等待论坛应用初始化后推送帖子详情层
    setTimeout(() => {
      if (typeof forumPushLayer === 'function') {
        forumPushLayer('post-detail', targetId);
        if (typeof forumInitPostDetailPage === 'function') {
          forumInitPostDetailPage(targetId);
        }
      }
    }, 300);
  }
};

window.safeOpenMomentFromShare = function(momentId, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (window.momentShareClickTimer) {
    clearTimeout(window.momentShareClickTimer);
  }
  window.momentShareClickTimer = setTimeout(() => {
    if (typeof openMomentFromShare === "function") {
      openMomentFromShare(momentId);
    }
  }, 500);
};

window.toggleRecallContent = function(el, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const container = el.parentNode.nextElementSibling;
  if (container) {
    if (container.style.display === "none") {
      container.style.display = "block";
      el.innerText = "收起";
    } else {
      container.style.display = "none";
      el.innerText = "查看";
    }
  }
};

let bubbleLongPressTimer = null;
let bubbleScaleTimer = null;
let activeLongPressBubbleEl = null;
let activePickerEl = null;

function startBubbleLongPress(msgId, bubbleEl, e) {
  if (isMultiSelectMode) return;
  
  if (e.target.closest('.voice-bubble-card') || e.target.closest('.msg-image-placeholder-card') || e.target.closest('.wallet-bubble-card')) {
    return;
  }

  if (bubbleLongPressTimer) clearTimeout(bubbleLongPressTimer);
  if (bubbleScaleTimer) clearTimeout(bubbleScaleTimer);
  
  activeLongPressBubbleEl = bubbleEl;

  // 1秒后气泡稍微缩小，进行触控回弹反馈 [1]
  bubbleScaleTimer = setTimeout(() => {
    bubbleEl.classList.add("bubble-longpressing");
  }, 1000);

  // 1.3秒后完成长按，恢复原状并弹出表情包选择器 [1]
  bubbleLongPressTimer = setTimeout(async () => {
    const msgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
    const last20 = msgs.slice(-20);
    const isWithinLastRounds = last20.some(m => m.id === Number(msgId));
    
    bubbleEl.classList.remove("bubble-longpressing");
    activeLongPressBubbleEl = null;

    if (!isWithinLastRounds) return;
    showEmojiPicker(msgId, bubbleEl);
  }, 1300);
}

function cancelBubbleLongPress(e) {
  if (bubbleLongPressTimer) {
    clearTimeout(bubbleLongPressTimer);
    bubbleLongPressTimer = null;
  }
  if (bubbleScaleTimer) {
    clearTimeout(bubbleScaleTimer);
    bubbleScaleTimer = null;
  }
  if (activeLongPressBubbleEl) {
    activeLongPressBubbleEl.classList.remove("bubble-longpressing");
    activeLongPressBubbleEl = null;
  }
}

function showEmojiPicker(msgId, bubbleEl) {
  if (activePickerEl) {
    activePickerEl.remove();
  }

  const picker = document.createElement("div");
  picker.className = "bubble-emoji-picker";

  // 表情反应 emoji 列表（表情贴图保留 emoji，符合用户要求）
  const emojis = ["😂", "😚", "😌", "😊", "👿", "😪", "😭", "😣", "🙄", "🥺", "🥵", "🥰", "😉", "😏"];
  
  const isSelf = bubbleEl.classList.contains("self");
  const alignStyle = isSelf ? "right: 0; transform: none;" : "left: 0; transform: none;";
  
  picker.style.cssText = "position: absolute; top: -38px; " + alignStyle + " display: flex; gap: 8px; background: #ffffff; border: 1.5px solid var(--border); border-radius: 20px; padding: 6px 12px; overflow-x: auto; white-space: nowrap; max-width: 220px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.15); scrollbar-width: none;";
  
  emojis.forEach(emo => {
    const span = document.createElement("span");
    span.className = "bubble-emoji-item";
    span.style.cssText = "font-size: 20px; cursor: pointer; transition: transform 0.1s ease; display: inline-block; padding: 0 4px;";
    span.innerText = emo;
    span.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await saveReaction(msgId, emo);
      picker.remove();
    };
    picker.appendChild(span);
  });

  bubbleEl.appendChild(picker);
  activePickerEl = picker;

  const clickAwayHandler = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove();
      document.removeEventListener("click", clickAwayHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", clickAwayHandler);
  }, 50);
}

async function saveReaction(msgId, emoji) {
  await db.messages.update(Number(msgId), { reactionEmoji: emoji });
  await renderDialogMessages();
}

window.removeReaction = async function(msgId, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  await db.messages.update(Number(msgId), { reactionEmoji: null });
  await renderDialogMessages();
};

async function initChatApp() {
  await loadMyPersonas();
  await renderChatTab();

  if (isChatAppInitialized) return;
  isChatAppInitialized = true;

  const tabs = document.querySelectorAll("#win-chat .chat-tabs .tab-item");
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentChatTab = tab.getAttribute("data-chat-tab"); // 核心修复：复位于标准的data-chat-tab，斩断路由未定义假死
      
      document.querySelectorAll(".chat-tab-panel").forEach(p => p.classList.remove("active"));
      const targetPanel = document.getElementById(`chat-tab-${currentChatTab}`);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }

      const btnNewChat = document.getElementById("btn-new-chat");
      const btnMomentsPost = document.getElementById("btn-moments-post");
      const btnMomentsSettings = document.getElementById("btn-moments-settings");
      
      if (btnNewChat) {
        btnNewChat.style.display = currentChatTab === 'sessions' ? 'flex' : 'none';
      }
      if (btnMomentsPost) {
        btnMomentsPost.style.display = currentChatTab === 'moments' ? 'flex' : 'none';
      }
      if (btnMomentsSettings) {
        btnMomentsSettings.style.display = currentChatTab === 'moments' ? 'flex' : 'none';
      }

      // 动态更新主标题内容
      const mainTitle = document.getElementById("chat-main-title");
      if (mainTitle) {
        if (currentChatTab === 'sessions') {
          mainTitle.innerText = "聊天";
        } else if (currentChatTab === 'moments') {
          mainTitle.innerText = "朋友圈";
          if (window.momentSystem && window.momentSystem.init) {
            window.momentSystem.init();
          }
        } else if (currentChatTab === 'me') {
          mainTitle.innerText = "我的";
        }
      }

      renderChatTab();
    };
  });

  initContextMenuHandlers();
  initOfflineContextMenuHandlers(); 
}

// 微信底部导航扁平切签路由
const chatFooterTabs = document.querySelectorAll("#win-chat .chat-tabs .tab-item");
chatFooterTabs.forEach(tab => {
  tab.onclick = () => {
    chatFooterTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentChatTab = tab.getAttribute("data-chat-tab");
    
    document.querySelectorAll(".chat-tab-panel").forEach(p => p.classList.remove("active"));
    const targetPanel = document.getElementById(`chat-tab-${currentChatTab}`);
    if (targetPanel) {
      targetPanel.classList.add("active");
    }

    const btnNewChat = document.getElementById("btn-new-chat");
    const btnMomentsPost = document.getElementById("btn-moments-post");
    const btnMomentsSettings = document.getElementById("btn-moments-settings");

    if (btnNewChat) {
      btnNewChat.style.display = currentChatTab === 'sessions' ? 'flex' : 'none';
    }
    if (btnMomentsPost) {
      btnMomentsPost.style.display = currentChatTab === 'moments' ? 'flex' : 'none';
    }
    if (btnMomentsSettings) {
      btnMomentsSettings.style.display = currentChatTab === 'moments' ? 'flex' : 'none';
    }

    // 动态更新主标题内容
    const mainTitle = document.getElementById("chat-main-title");
    if (mainTitle) {
      if (currentChatTab === 'sessions') {
        mainTitle.innerText = "对话";
      } else if (currentChatTab === 'moments') {
        mainTitle.innerText = "朋友圈";
        if (window.momentSystem && window.momentSystem.init) {
          window.momentSystem.init();
        }
      } else if (currentChatTab === 'me') {
        mainTitle.innerText = "我的";
      }
    }

    renderChatTab();
  };
});

// 渲染我的人设选中状态卡片
async function updateMeActiveCard(userId) {
  const activeCard = document.getElementById("me-active-card");
  const avatarEl = document.getElementById("me-active-avatar");
  const groupEl = document.getElementById("me-active-group");
  const nameEl = document.getElementById("me-active-name");
  const remarkEl = document.getElementById("me-active-remark");

  if (!activeCard) return;

  if (isNaN(Number(userId))) {
    activeCard.style.display = "none";
    return;
  }

  const user = await db.archives.get(Number(userId));
  if (user) {
    if (avatarEl) avatarEl.src = resolveAvatar(user.avatar);
    if (groupEl) groupEl.innerText = user.group || "默认分组";
    if (nameEl) nameEl.innerText = user.name;
    if (remarkEl) remarkEl.innerText = user.remark || "暂无备注";
    activeCard.style.display = "flex";
  } else {
    activeCard.style.display = "none";
  }
}

// 渲染“我的人设”选择 (重构为卡片点击式候选面板)
async function loadMyPersonas() {
  const activeCard = document.getElementById("me-active-card");
  const selectorContainer = document.getElementById("me-selector-container");
  const candidatesContainer = document.getElementById("me-candidate-cards");
  
  if (!activeCard || !selectorContainer || !candidatesContainer) return;

  try {
    const allArchives = await db.archives.toArray();
    const users = allArchives.filter(u => u.type === 'user');
    
    // 渲染候选人设卡片列表
    candidatesContainer.innerHTML = "";
    if (users.length === 0) {
      candidatesContainer.innerHTML = `<p style="font-size: 12px; color: var(--text-secondary); text-align: center; padding: 10px 0;">暂无候选用户人设，请前往档案库创建！</p>`;
    } else {
      users.forEach(u => {
        const card = document.createElement("div");
        card.className = "candidate-persona-card";
        card.style.cssText = "background: #ffffff; border: 1.5px solid var(--border); border-radius: 10px; padding: 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: all 0.2s;";
        card.innerHTML = `
          <img src="${resolveAvatar(u.avatar)}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
          <div style="flex: 1; text-align: left;">
            <div style="font-size: 9px; color: var(--text-secondary); font-weight: 500;">${u.group || '默认分组'}</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 2px 0;">${u.name}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${u.remark || '暂无备注'}</div>
          </div>
        `;
        card.onclick = async () => {
          activeUserPersonaId = u.id;
          localStorage.setItem("active_me_id", u.id);
          await updateMeActiveCard(u.id);
          updateMeHeader(u.id);
          selectorContainer.style.display = "none";
          if (currentChatTab === 'sessions') renderChatTab();
        };
        candidatesContainer.appendChild(card);
      });
    }

    activeUserPersonaId = localStorage.getItem("active_me_id");
    if (activeUserPersonaId && activeUserPersonaId !== "null" && activeUserPersonaId !== "undefined") {
      const userIdNum = Number(activeUserPersonaId);
      // 关键修复：检查 archive 是否仍然存在（可能已在档案库被删除）
      // 若已删除却仍走原逻辑，updateMeActiveCard 会隐藏 activeCard，同时 selectorContainer 也被隐藏 → 死锁
      const userExists = await db.archives.get(userIdNum);
      if (userExists) {
        await updateMeActiveCard(userIdNum);
        updateMeHeader(userIdNum);
        selectorContainer.style.display = "none";
      } else {
        // archive 已被删除：清空悬空引用，回退到"未选择"状态以显示候选列表
        activeUserPersonaId = null;
        localStorage.removeItem("active_me_id");
        activeCard.style.display = "none";
        selectorContainer.style.display = "block";
      }
    } else {
      activeUserPersonaId = null;
      activeCard.style.display = "none";
      selectorContainer.style.display = "block";
    }

    // 点击当前选中卡片，可以展开/折叠候选列表以供重新选择
    activeCard.onclick = () => {
      if (selectorContainer.style.display === "none") {
        selectorContainer.style.display = "block";
      } else {
        selectorContainer.style.display = "none";
      }
    };

  } catch (err) {
    console.error("加载我的人设失败:", err);
  }
}

async function updateMeHeader(userId) {
  if (isNaN(Number(userId))) return;
  const user = await db.archives.get(userId);
  if (user) {
    const nameEl = document.getElementById("moment-user-name");
    const avatarEl = document.getElementById("moment-user-avatar");
    if (nameEl) nameEl.innerText = user.name;
    if (avatarEl) avatarEl.src = resolveAvatar(user.avatar);
  }
}

// 渲染对应页签
async function renderChatTab() {
  if (currentChatTab === 'sessions') {
    renderSessionList();
  }
}

// 会话加载列表
async function renderSessionList() {
  const container = document.getElementById("session-list-container");
  if (!container) return;
  container.innerHTML = "";

  const userIdNum = Number(activeUserPersonaId);
  if (!activeUserPersonaId || isNaN(userIdNum)) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">请先到 “我的” 选项卡下选择我的人设！</p>`;
    return;
  }

  try {
    const list = await db.sessions.where('userId').equals(userIdNum).toArray();
    if (list.length === 0) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">暂无会话，请点击右上角新建</p>`;
      return;
    }

    for (let s of list) {
          let char = null;
          if (s.isGroup !== 1) {
            char = await db.archives.get(s.charId);
          }
          const rawMsgs = await db.messages.where('sessionId').equals(s.id).toArray();
          const latestMsg = rawMsgs.sort((a, b) => b.timestamp - a.timestamp)[0];
          
          let latestText = "暂无对话消息";
          if (latestMsg) {
            if (latestMsg.contentType === 'transfer') {
              latestText = "[微信转账]";
            } else if (latestMsg.contentType === 'red_envelope') {
              latestText = "[微信红包]";
            } else if (latestMsg.contentType === 'voice') {
              latestText = "[语音消息]";
            } else if (latestMsg.contentType === 'moment_share') {
              latestText = "[转发了一条朋友圈]";
            } else if (latestMsg.contentType === 'social_notice') {
              try {
                const sn = JSON.parse(latestMsg.content);
                latestText = sn.type === 'moment' ? "[对方发了一条朋友圈]" :
                             sn.type === 'forum_post' ? "[对方在论坛发了帖子]" :
                             sn.type === 'forum_alt_create' ? "[对方建立了论坛小号]" : "[社交动态]";
              } catch(e) { latestText = "[社交动态]"; }
            } else if (latestMsg.contentType === 'group_poll') {
              latestText = "[群投票]";
            } else if (latestMsg.contentType === 'mcp_tool') {
              latestText = "[外部工具调用记录]";
            } else if (latestMsg.contentType === 'image' && typeof latestMsg.content === 'string' && latestMsg.content.startsWith("{")) {
              latestText = "[图片与描述]";
            } else {
              latestText = latestMsg.content;
              if (typeof latestText === 'string') {
                latestText = latestText.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '');
              }
            }
          }
          
          const timeDisplay = formatWeChatTime(new Date(latestMsg ? latestMsg.timestamp : (s.lastMessageTime || Date.now())), new Date());
          const div = document.createElement("div");
          div.className = "session-item";
          div.onclick = () => openWeChatDialog(s.id);
          div.innerHTML = `
            <img class="session-avatar" src="${resolveAvatar(s.customCharAvatar || char?.avatar)}" onerror="avatarFallback(this)">
            <div class="session-detail">
              <div class="session-row">
                <span class="session-name">${escapeHtml(s.customCharName || char?.name || '未知角色')}</span>
                <span class="session-time">${timeDisplay}</span>
              </div>
              <div class="session-msg">${latestText}</div>
            </div>
          `;
          container.appendChild(div);
        }
  } catch (err) {
    console.error("加载会话列表失败:", err);
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">加载会话列表出错，请重试</p>`;
  }
}

// 展开单聊
// 动态更新输入框锁定遮罩状态
function updateChatInputLockState(sess) {
  const normalInputRow = document.getElementById("normal-input-row");
  const blockedByUserBar = document.getElementById("blocked-by-user-bar");
  
  if (!normalInputRow || !blockedByUserBar) return;
  
  if (sess && sess.isBlockedByUser === 1) {
    normalInputRow.style.display = "none";
    blockedByUserBar.style.display = "flex";
  } else {
    normalInputRow.style.display = "flex";
    blockedByUserBar.style.display = "none";
  }
}

async function openWeChatDialog(sessionId) {
  activeSessionId = sessionId;

  // 会话隔离：清除上一个会话遗留的 typing 标题样式，避免新会话显示"正在输入"
  const oldHeader = document.getElementById("dialog-header-title");
  if (oldHeader) oldHeader.classList.remove("header-typing");

  // 会话隔离：如果上一个会话有正在进行的请求，但本次切换到了不同会话，
  // 则把回复按钮重置为"发送"图标（请求仍在后台运行，但新会话不应显示"停止"按钮）
  if (onlineAbortController && onlineAbortController._reqSessionId !== sessionId) {
    const oldBtnReply = document.getElementById("btn-dialog-reply");
    if (oldBtnReply) {
      oldBtnReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
    }
  }
  // 如果切换回的就是请求所属的会话，恢复"停止"按钮（表示请求仍在进行中）
  if (onlineAbortController && onlineAbortController._reqSessionId === sessionId) {
    const curBtnReply = document.getElementById("btn-dialog-reply");
    if (curBtnReply) {
      curBtnReply.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="#f87171"/></svg>';
    }
    const curHeader = document.getElementById("dialog-header-title");
    if (curHeader) curHeader.classList.add("header-typing");
  }

  // 同步清除上一次对话残留，彻底根治切换对话时的闪屏
  const container = document.getElementById("dialog-messages-container");
  if (container) container.innerHTML = "";

  // 自动载入并应用当前聊天窗口的个性化美化样式，根治切换会话和冷启动时的闪变
  if (window.chatBeautifySystem && typeof window.chatBeautifySystem.loadActiveConfig === "function") {
    window.chatBeautifySystem.loadActiveConfig(sessionId);
  }

  const sess = await db.sessions.get(sessionId);

  // 核心同步：从数据库读取真实 cotToggle 状态，精确同步给 cotSystem
  if (window.cotSystem && sess) {
    window.cotSystem.currentSessionCotToggle = (sess.cotToggle === 1);
  }
  
  // 群聊专属拦截路由
  if (sess && sess.isGroup === 1) {
    if (window.groupChatSystem) {
      await window.groupChatSystem.openGroupDialog(sessionId);
      return;
    }
  }

  // 清理群置顶公告，防止其穿透并残留留在单聊视窗中
  const stickyBar = document.getElementById("group-announcement-sticky");
  if (stickyBar) stickyBar.remove();

  // 单聊展示右上角心声状态粉色爱心按钮
             const btnCharStatus = document.getElementById("btn-char-status");
             if (btnCharStatus) btnCharStatus.style.display = "flex";

             // 核心解耦：开启单聊专属加号展开栏排布，完整恢复并显现 14 项原生功能按键
             if (window.setupExpandPanel) {
               window.setupExpandPanel('single');
             }

             const char = await db.archives.get(sess.charId);
             const user = await db.archives.get(sess.userId);

  activeSessionCharAvatar = sess.customCharAvatar || char?.avatar || null;
  activeSessionUserAvatar = sess.customUserAvatar || user?.avatar || null;
  
  document.getElementById("dialog-header-title").innerText = sess.customCharName || char?.name || "未知角色";
  document.getElementById("chat-dialog-panel").classList.add("active");

  updateThemeColor("#ededed");

  exitMultiSelectMode();
  updateChatInputLockState(sess);
  renderDialogMessages();
}

function closeChatDialog() {
  document.getElementById("chat-dialog-panel").classList.remove("active");
  updateThemeColor("#f4f6fa");
  
  // 会话关闭时物理拔除置顶公告条
  const stickyBar = document.getElementById("group-announcement-sticky");
  if (stickyBar) stickyBar.remove();

  renderSessionList();
}

// 全局分页与内存预载字典变量
let chatPageOffset = 0;
const CHAT_PAGE_SIZE = 30;
let isChatLoadingMore = false;
let hasMoreChatMessages = true;

// 绑定顶部触顶下拉加载历史消息监听器
function initChatScrollListener(container) {
  container.onscroll = async () => {
    if (container.scrollTop < 30 && !isChatLoadingMore && hasMoreChatMessages) {
      isChatLoadingMore = true;
      let loader = document.getElementById("chat-history-loader-notice");
      if (!loader) {
        loader = document.createElement("div");
        loader.id = "chat-history-loader-notice";
        loader.style.cssText = "text-align:center; font-size:11px; color:#94a3b8; padding:8px 0; user-select:none; width:100%;";
        loader.innerText = "正在加载更多历史对话...";
        container.insertBefore(loader, container.firstChild);
      }

      try {
        await renderDialogMessages(false);
      } catch(e) {
        console.error("分页加载历史消息异常:", e);
      } finally {
        if (loader) loader.remove();
        isChatLoadingMore = false;
      }
    }
  };
}

// 微信级“首屏 30 条分页” + “内存预载字典”极速渲染引擎
async function renderDialogMessages(isInitial = true) {
  const container = document.getElementById("dialog-messages-container");
  if (!container) return;

  // 判断是"全新打开会话"还是"操作后刷新当前视图"
  // 若容器已有内容且 offset>0，说明用户已经浏览到某个位置，应保持视图不跳转
  const isRefresh = isInitial && container.children.length > 0 && chatPageOffset > 0;

  // 操作后刷新：保存当前首个可见消息 ID 及是否在底部，用于渲染后精准回滚滚动位置
  let savedAnchorMsgId = null;
  let wasNearBottom = false;
  if (isRefresh) {
    wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
    // 仅当用户不在底部时才需要锚定（在底部则刷新后仍滚到底部）
    if (!wasNearBottom) {
      // 跳过时间戳分隔条等无 data-msg-id 的元素，找到第一个真正的消息元素
      for (const child of container.children) {
        const mid = child.getAttribute("data-msg-id");
        if (mid) { savedAnchorMsgId = mid; break; }
      }
    }
  } else if (isInitial) {
    chatPageOffset = 0;
    hasMoreChatMessages = true;
    container.innerHTML = "";
    initChatScrollListener(container);
  }

  const sess = await db.sessions.get(activeSessionId);
  const user = await db.archives.get(sess.userId);

  // 操作后刷新：重新加载之前已加载的所有消息（从 offset 0 到当前 chatPageOffset）
  let rawMsgs;
  if (isRefresh) {
    const previouslyLoaded = chatPageOffset;
    rawMsgs = await db.messages
      .where('sessionId').equals(activeSessionId)
      .reverse()
      .limit(previouslyLoaded)
      .toArray();
  } else {
    // 1. 只拉取最新的 CHAT_PAGE_SIZE (30) 条消息，实现毫秒级秒开
    rawMsgs = await db.messages
      .where('sessionId').equals(activeSessionId)
      .reverse()
      .offset(chatPageOffset)
      .limit(CHAT_PAGE_SIZE)
      .toArray();
  }

  if (rawMsgs.length < CHAT_PAGE_SIZE) {
    hasMoreChatMessages = false;
  }

  if (!isRefresh) {
    chatPageOffset += rawMsgs.length;
  }
  const msgs = rawMsgs.reverse(); // 恢复正向时间流顺序

  const fragment = document.createDocumentFragment();
  const charAvatarUrl = resolveAvatar(activeSessionCharAvatar);
  const userAvatarUrl = resolveAvatar(activeSessionUserAvatar);

  let mountedGroupIds = [];
  if (window.stickerSystem && window.stickerSystem.getMountedGroupIds) {
    mountedGroupIds = await window.stickerSystem.getMountedGroupIds(activeSessionId);
  }

  let prevMsgDisplayTime = null;

  for (const m of msgs) {
        // 通话中的对白消息（带 callId）不上屏，只在通话记录卡片内查看
        if (m.callId) continue;

        // 历史消息残留标签清洗：[图片描述: xxx] / [图片: xxx] 归一化为图片消息
        // 仅对文本类型消息处理，避免重复处理已是 image 类型的消息
        if (m.contentType === 'text' && m.content && /\[[^\]]*图片[^\]]*\]/.test(m.content)) {
          const matched = m.content.match(/[\[【]\s*图片(?:描述)?\s*[:：]\s*([\s\S]*?)[\]】]/);
          if (matched) {
            // 将文本消息升级为图片消息（内存中修改，不写库，避免破坏原数据）
            m._originalContent = m.content;
            m.contentType = 'image';
            m.content = JSON.stringify({ url: '', text: matched[1].trim(), legacyTag: true });
          }
        }

        const currentDisplayTime = getMessageDisplayDate(m, sess);
        let showTimestamp = false;
        if (prevMsgDisplayTime === null) {
          showTimestamp = true;
        } else {
          const diff = currentDisplayTime.getTime() - prevMsgDisplayTime.getTime();
          if (diff > 3 * 60 * 1000) {
            showTimestamp = true;
          }
        }
        prevMsgDisplayTime = currentDisplayTime;

        if (showTimestamp) {
          const timeDiv = document.createElement("div");
          timeDiv.className = "chat-time-divider";
          timeDiv.style.cssText = "text-align: center; margin: 12px 0; font-size: 11.5px; color: #b2b2b2; user-select: none;";
          timeDiv.innerText = formatWeChatTime(currentDisplayTime, getSimulatedNow(sess));
          fragment.appendChild(timeDiv);
        }

        // 核心支持：将 senderType === 'system' 的系统消息渲染为微信中间灰字
        // 注意：contentType === 'call' / 'social_notice' 的卡片需走专用渲染分支，不能在此当纯文本显示
        if (m.senderType === 'system' && m.contentType !== 'call' && m.contentType !== 'social_notice') {
          const sysEl = document.createElement("div");
          sysEl.className = "group-system-notice-container";
          sysEl.setAttribute("data-msg-id", m.id);
          sysEl.style.cssText = "display: flex; justify-content: center; align-items: center; width: 100%; margin: 8px 0; box-sizing: border-box; padding: 0 16px;";
          sysEl.innerHTML = `
            <div style="background-color: rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 4px; font-size: 11px; color: #7f7f7f; user-select: none; max-width: 85%; text-align: center; line-height: 1.4;">
              ${escapeHtml(m.content)}
            </div>
          `;
          fragment.appendChild(sysEl);
          continue;
        }

        if (m.isRecalled === 1) {
          const recallEl = document.createElement("div");
          recallEl.className = "recalled-system-msg-container";
          recallEl.setAttribute("data-msg-id", m.id);
          recallEl.style.cssText = "display: flex; justify-content: center; align-items: center; width: 100%; margin: 8px 0; box-sizing: border-box; padding: 0 16px;";
          recallEl.innerHTML = `
            <div style="background-color: rgba(0,0,0,0.05); padding: 6px 12px; border-radius: 4px; font-size: 11.5px; color: #999; user-select: none; max-width: 85%; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center;">
              <div style="pointer-events: none;">
                ${m.senderType === 'user' ? '你' : '对方'} 撤回了一条消息 
                <span class="recall-view-btn" style="color: #576b95; font-size: 10.5px; margin-left: 4px; cursor: pointer; pointer-events: auto;" onclick="window.toggleRecallContent(this, event)">查看</span>
              </div>
              <div class="recall-original-content" style="display: none; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 4px; margin-top: 4px; color: #666; font-size: 11px; word-break: break-all; width: 100%; text-align: left;">
                ${escapeHtml(m.content)}
              </div>
            </div>
          `;
          recallEl.ondblclick = (e) => {
            e.preventDefault();
            if (isMultiSelectMode) return;
            selectedMsgId = m.id;
            
            if (window.momentShareClickTimer) {
              clearTimeout(window.momentShareClickTimer);
              window.momentShareClickTimer = null;
            }
            
            const btnRecall = document.getElementById("btn-menu-recall");
            if (btnRecall) btnRecall.style.display = "none";
            
            document.getElementById("bubble-context-menu").style.display = "flex";
          };
          fragment.appendChild(recallEl);
          continue;
        }

        const bubble = document.createElement("div");
    bubble.className = `msg-bubble ${m.senderType === 'user' ? 'self' : 'other'}`;
    bubble.setAttribute("data-msg-id", m.id);
    bubble.style.position = "relative";

    bubble.ondblclick = async (e) => {
      e.preventDefault();
      if (isMultiSelectMode) return;
      selectedMsgId = m.id;
      
      if (window.momentShareClickTimer) {
        clearTimeout(window.momentShareClickTimer);
        window.momentShareClickTimer = null;
      }
      
      const msg = await db.messages.get(m.id);
      const btnRecall = document.getElementById("btn-menu-recall");
      if (btnRecall && msg) {
        const isUserMsg = msg.senderType === 'user';
        if (isUserMsg && !msg.isRecalled) {
          btnRecall.style.display = "block";
        } else {
          btnRecall.style.display = "none";
        }
      }
      
      document.getElementById("bubble-context-menu").style.display = "flex";
    };

    bubble.onmousedown = (e) => startBubbleLongPress(m.id, bubble, e);
    bubble.onmouseup = (e) => cancelBubbleLongPress(e);
    bubble.onmouseleave = (e) => cancelBubbleLongPress(e);
    bubble.ontouchstart = (e) => startBubbleLongPress(m.id, bubble, e);
    bubble.ontouchend = (e) => cancelBubbleLongPress(e);
    
    const emojiHtml = m.reactionEmoji ? `<div class="bubble-attached-emoji" onclick="window.removeReaction(${m.id}, event)">${m.reactionEmoji}</div>` : "";
    let contentHtml = "";
    if (m.contentType === 'image') {
      try {
        const data = JSON.parse(m.content);
        const captionText = data.text || "场景画面";
        const isGenerating = data.generating === true;
        const isRealImage = data.url && data.url.startsWith("data:image/") && !data.url.includes("svg+xml");

        const hasTrans = m.translatedContent && m.showTranslation === 1;
        let imgTransHtml = escapeHtml(captionText);
        if (hasTrans) {
          imgTransHtml += `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.15); font-size:11.5px; color:#0284c7; font-weight:normal; text-align:justify;"><span style="font-weight:700; color:#0284c7; margin-right:4px;">[译]</span>${escapeHtml(m.translatedContent)}</div>`;
        }

        if (isGenerating) {
          contentHtml = `
            <div class="msg-image-placeholder-card" style="padding:18px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:18px; height:18px; border:2.5px solid var(--border); border-top-color:#ec4899; border-radius:50%; animation:imagegen-spin 0.8s linear infinite; flex-shrink:0;"></div>
                <span style="font-size:12.5px; color:var(--text-secondary); font-weight:600;">正在生成图片…</span>
              </div>
            </div>
          `;
        } else if (isRealImage) {
          // 生图消息：单击展开全屏大图，双击收藏到收藏室-图片
          // 用 data-url 属性传递图片地址，事件由全局 imageGenSystem 处理
          const imgUrl = data.url || '';
          const safeImgUrl = imgUrl.replace(/"/g, '&quot;');
          contentHtml = `
            <div class="image-bubble-card" onclick="toggleImageText(${m.id}, this)" style="position: relative;">
              <img src="${imgUrl}" class="msg-img" data-img-url="${safeImgUrl}" onerror="this.style.display='none'; document.getElementById('img-fallback-${m.id}').style.display='flex';">
              <div id="img-fallback-${m.id}" class="msg-image-placeholder-card" style="display:none; width: 100%;">
                <div class="msg-image-placeholder-header">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <span class="msg-image-placeholder-title">发送了画面图片</span>
                </div>
                <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
              </div>
              <div class="image-description-text" id="image-desc-${m.id}" style="display: ${hasTrans ? 'block' : 'none'}; max-height: 140px; overflow-y: auto;">
                ${imgTransHtml}
              </div>
              ${emojiHtml}
            </div>
          `;
        } else {
          contentHtml = `
            <div class="msg-image-placeholder-card" onclick="toggleImageText(${m.id}, this)" style="position: relative;">
              <div class="msg-image-placeholder-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span class="msg-image-placeholder-title">发送了画面图片</span>
              </div>
              <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
              <div class="image-description-text" id="image-desc-${m.id}" style="display: ${hasTrans ? 'block' : 'none'}; max-height: 140px; overflow-y: auto; margin-top:8px;">
                ${imgTransHtml}
              </div>
              ${emojiHtml}
            </div>
          `;
        }
      } catch(e) {
        contentHtml = `
          <div class="msg-image-placeholder-card" onclick="toggleImageText(${m.id}, this)" style="position: relative;">
            <div class="msg-image-placeholder-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span class="msg-image-placeholder-title">发送了画面图片</span>
            </div>
            <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
            <div class="image-description-text" id="image-desc-${m.id}" style="display: ${m.showTranslation === 1 ? 'block' : 'none'}; max-height: 140px; overflow-y: auto; margin-top:8px;">
              ${escapeHtml(m.content)}
            </div>
            ${emojiHtml}
          </div>
        `;
      }
    } else if (m.contentType === 'voice') {
      try {
        const data = JSON.parse(m.content);
        const width = Math.min(180, 75 + data.duration * 2);
        const align = m.senderType === 'user' ? 'flex-end' : 'flex-start';

        const hasTrans = m.translatedContent && m.showTranslation === 1;
        let voiceTransHtml = escapeHtml(data.text);
        if (hasTrans) {
          voiceTransHtml += `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.15); font-size:11.5px; color:#0284c7; font-weight:normal; text-align:justify;"><span style="font-weight:700; color:#0284c7; margin-right:4px;">[译]</span>${escapeHtml(m.translatedContent)}</div>`;
        }

        contentHtml = `
          <div style="display:flex; flex-direction:column; align-items: ${align}; gap:4px; max-width:220px; position: relative;">
            <div class="voice-bubble-card" onclick="toggleVoiceTranslation(${m.id}, this)" style="width: ${width}px; position: relative;">
              <div class="voice-bubble-wave">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;">
                  <path d="M12 1v22M17 5v14M22 9v6M7 5v14M2 9v6"/>
                </svg>
              </div>
              <div class="voice-bubble-duration">${data.duration}"</div>
              ${emojiHtml}
            </div>
            <div class="voice-translation-text" id="voice-trans-${m.id}" style="display: ${hasTrans ? 'block' : 'none'};">
              ${voiceTransHtml}
            </div>
          </div>
        `;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">语音数据格式错误${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'transfer') {
      try {
        const data = JSON.parse(m.content);
        const amount = parseFloat(data.amount) || 0;
        const statusClass = data.status || 'pending';
        const statusLabel = statusClass === 'received' ? '已收钱' : '待接收';
        const targetLabel = data.targetName ? `（给 ${escapeHtml(data.targetName)}）` : "";
        contentHtml = `
          <div class="wallet-bubble-card transfer ${statusClass}" onclick="walletSystem.claimTransfer(${m.id})" style="position: relative;">
            <div class="wallet-bubble-body">
              <div class="wallet-bubble-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" ry="2"/>
                  <line x1="2" y1="10" x2="22" y2="10"/>
                </svg>
              </div>
              <div class="wallet-bubble-details">
                <div class="wallet-bubble-title">微信转账 ${targetLabel}</div>
                <div class="wallet-bubble-amount">¥ ${amount.toFixed(2)}</div>
              </div>
            </div>
            <div class="wallet-bubble-footer">${statusLabel}</div>
            ${emojiHtml}
          </div>
        `;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">转账格式异常${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'red_envelope') {
      try {
        const data = JSON.parse(m.content);
        const amount = parseFloat(data.amount) || 0;
        const remark = escapeHtml(data.remark || '恭喜发财，大吉大利');
        const isLucky = data.type === 'lucky';
        const typeLabel = isLucky ? ' 拼手气' : '';
        const statusClass = data.status || 'pending';
        const statusLabel = statusClass === 'opened' ? `微信${typeLabel}红包（已领取）` : `微信${typeLabel}红包`;
        contentHtml = `
          <div class="wallet-bubble-card red-envelope ${statusClass}" onclick="walletSystem.claimRedEnvelope(${m.id})" style="position: relative;">
            <div class="wallet-bubble-body">
              <div class="wallet-bubble-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <div class="wallet-bubble-details">
                <div class="wallet-bubble-title">${remark}</div>
                <div class="wallet-bubble-desc">查看红包</div>
              </div>
            </div>
            <div class="wallet-bubble-footer">${statusLabel}</div>
            ${emojiHtml}
          </div>
        `;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">红包格式异常${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'location') {
      try {
        const locData = JSON.parse(m.content);
        contentHtml = buildLocationCardHtml(locData, m.id);
      } catch(e) {
        contentHtml = `<div style="font-size:13px; color:#999;">[位置消息解析失败]</div>`;
      }
    } else if (m.contentType === 'pay_for_me' || m.contentType === 'gift') {
      try {
        const cardData = JSON.parse(m.content);
        const isGift = m.contentType === 'gift';
        const isPaid = cardData.status === 'paid';
        const titleText = isGift ? '礼物小票' : '代付请求';
        const itemsHtml = (cardData.items || []).map(item =>
          `<div style="display:flex; justify-content:space-between; font-size:11px; padding:2px 0;"><span style="color:#333;">${escapeHtml(item.name || item.title || '商品')} x${item.quantity || 1}</span><span style="color:#333;">¥${(item.price || 0).toFixed(2)}</span></div>`
        ).join('');
        contentHtml = `
          <div class="receipt-bubble-card" style="width:240px; background:#fff; border-radius:8px; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <div style="background:${isGift ? '#1a1a2e' : '#000'}; color:#fff; padding:8px 12px; text-align:center; font-size:12px; font-weight:700; letter-spacing:1px;">${titleText}</div>
            <div style="padding:10px 12px; border-bottom:1px dashed #eee;">
              ${itemsHtml || '<div style="font-size:11px; color:#999; text-align:center; padding:4px;">暂无商品明细</div>'}
            </div>
            ${cardData.message ? `<div style="padding:8px 12px; border-bottom:1px dashed #eee; font-size:11px; color:#666; font-style:italic;">"${escapeHtml(cardData.message)}"</div>` : ''}
            <div style="padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:#999;">合计</span>
              <span style="font-size:16px; font-weight:700; color:#000;">¥${(cardData.total || 0).toFixed(2)}</span>
            </div>
            <div style="padding:6px 12px 10px; text-align:center;">
              ${isGift
                ? `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#e8e8e8; color:#666;">${isPaid ? '已查收' : '一份心意'}</span>`
                : isPaid
                  ? `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#1a1a2e; color:#fff;">已付款</span>`
                  : `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#fdf0e8; color:#e87d5e; border:1px solid #e87d5e;">待付款</span>`
              }
            </div>
          </div>
        `;
      } catch(e) {
        contentHtml = `<div style="font-size:13px; color:#999;">[${m.contentType === 'gift' ? '礼物' : '代付'}消息解析失败]</div>`;
      }
    } else if (m.contentType === 'withdraw_share') {
      try {
        const data = JSON.parse(m.content);
        const linkText = data.linkText || '【提现助力】帮我点一下';
        contentHtml = `<div class="withdraw-share-link" style="color:#576b95; text-decoration:underline; word-break:break-all; font-size:14px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(linkText)}</div>`;
      } catch(e) {
        contentHtml = `<div style="font-size:13px; color:#999;">[分享链接]</div>`;
      }
    } else if (m.contentType === 'moment_share') {
      try {
        const data = JSON.parse(m.content);
        contentHtml = `
          <div class="wallet-bubble-card" style="background-color: #ffffff; border: 1.5px solid var(--border); border-radius: 8px; width: 220px; cursor: pointer; position: relative;" onclick="window.safeOpenMomentFromShare(${data.momentId}, event)">
            <div class="wallet-bubble-body" style="padding: 10px; display: flex; flex-direction: column; gap: 4px;">
              <div style="font-size: 11px; color: var(--text-secondary); font-weight:700;">转发了朋友圈动态</div>
              <div style="font-size: 13px; font-weight: 700; color: #1e293b; border-bottom: 1.5px dashed var(--border); padding-bottom: 6px;">
                ${data.authorName} 的朋友圈
              </div>
              <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px; font-style: italic;">
                “ ${escapeHtml(data.summary)} ”
              </div>
              ${data.commentText ? `<div style="font-size: 12px; color: #576b95; margin-top: 6px; font-weight:700;">附言：${escapeHtml(data.commentText)}</div>` : ''}
            </div>
            <div style="background-color: #fafbfc; font-size: 10px; padding: 6px 10px; border-top: 1px solid var(--border); text-align: right; color: var(--text-secondary); border-radius: 0 0 8px 8px;">轻触在朋友圈中查看</div>
            ${emojiHtml}
          </div>
        `;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">朋友圈分享格式错误${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'forum_post_share') {
      try {
        const data = JSON.parse(m.content);
        contentHtml = `
          <div class="wallet-bubble-card" style="background-color: #ffffff; border: 1.5px solid var(--border); border-radius: 8px; width: 220px; cursor: pointer; position: relative;" onclick="window.openSocialNotice('forum_post', ${data.postId})">
            <div class="wallet-bubble-body" style="padding: 10px; display: flex; flex-direction: column; gap: 4px;">
              <div style="font-size: 11px; color: var(--text-secondary); font-weight:700;">转发了论坛帖子</div>
              <div style="font-size: 13px; font-weight: 700; color: #1e293b; border-bottom: 1.5px dashed var(--border); padding-bottom: 6px;">
                ${escapeHtml(data.authorName)} 的帖子
              </div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-top: 4px;">
                ${escapeHtml(data.title)}
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px; font-style: italic;">
                “ ${escapeHtml(data.summary)} ”
              </div>
              ${data.commentText ? `<div style="font-size: 12px; color: #576b95; margin-top: 6px; font-weight:700;">附言：${escapeHtml(data.commentText)}</div>` : ''}
            </div>
            <div style="background-color: #fafbfc; font-size: 10px; padding: 6px 10px; border-top: 1px solid var(--border); text-align: right; color: var(--text-secondary); border-radius: 0 0 8px 8px;">轻触在论坛中查看</div>
            ${emojiHtml}
          </div>
        `;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">论坛帖子分享格式错误${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'mcp_tool') {
      try {
        const toolData = JSON.parse(m.content);
        const cardHtml = buildMcpToolCardHtml(m.id, toolData);
        const cardContainer = document.createElement("div");
        cardContainer.setAttribute("data-msg-id", m.id);
        cardContainer.style.cssText = "width: 100%; display: flex; justify-content: center;";
        cardContainer.innerHTML = cardHtml;
        fragment.appendChild(cardContainer);
        continue;
      } catch(e) {
        contentHtml = `<div class="msg-text" style="position: relative;">工具调用记录解析异常${emojiHtml}</div>`;
      }
    } else if (m.contentType === 'social_notice') {
      // 社交动作跳转卡片（批量渲染分支）：char 发了朋友圈/论坛帖，点击跳转查看
      try {
        const data = JSON.parse(m.content);
        const cardEl = buildSocialNoticeCard(data);
        cardEl.setAttribute("data-msg-id", m.id);
        fragment.appendChild(cardEl);
      } catch(e) {
        // 解析失败则降级为纯文本
        const sysEl = document.createElement("div");
        sysEl.className = "group-system-notice-container";
        sysEl.setAttribute("data-msg-id", m.id);
        sysEl.style.cssText = "display: flex; justify-content: center; width: 100%; margin: 8px 0; padding: 0 16px;";
        sysEl.innerHTML = `<div style="background-color: rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 4px; font-size: 11px; color: #7f7f7f; max-width: 85%; text-align: center;">${escapeHtml(m.content)}</div>`;
        fragment.appendChild(sysEl);
      }
      continue;
    } else if (m.contentType === 'call') {
      // 通话记录系统卡片（批量渲染分支）
      if (window.callSystem && typeof window.callSystem.renderCallRecordCard === "function") {
        const cardWrap = window.callSystem.renderCallRecordCard(m);
        cardWrap.setAttribute("data-msg-id", m.id);
        fragment.appendChild(cardWrap);
      }
      continue;
    } else {
      // 核心解耦：仅群聊会话支持表情包自动分割气泡；单聊会话 100% 保持原有不分割扁平布局，防止其被搞坏
      if (sess && sess.isGroup === 1) {
        const rawContent = m.content;
        let quoteHtml = "";
        let displayContent = rawContent;
        if (window.quoteSystem) {
          const parsed = await window.quoteSystem.parseQuote(rawContent);
          if (parsed) {
            quoteHtml = parsed.quoteHtml;
            displayContent = parsed.cleanText;
          }
        }

        const stickerRegex = /(【表情包：[^】]+】)/g;
        const parts = displayContent.split(stickerRegex).filter(Boolean);
        
        let segmentsHtml = "";
        for (const part of parts) {
          if (part.startsWith("【表情包：") && part.endsWith("】")) {
            const stickerImgHtml = window.stickerSystem ? window.stickerSystem.renderStickerInMessageSync(part, mountedGroupIds) : part;
            if (stickerImgHtml.includes("<img")) {
              segmentsHtml += `<div class="msg-sticker-alone-wrapper" style="position: relative; margin-top: 4px; display: block;">${stickerImgHtml}${emojiHtml}</div>`;
            } else {
              segmentsHtml += `<div class="msg-text" style="position: relative; margin-top: 4px; display: block;">${escapeHtml(part)}${emojiHtml}</div>`;
            }
          } else {
            let textNode = window.stickerSystem ? window.stickerSystem.renderStickerInMessageSync(part, mountedGroupIds) : part;
            segmentsHtml += `<div class="msg-text" style="position: relative; margin-top: 4px; display: block;">${quoteHtml}${textNode}${emojiHtml}</div>`;
            quoteHtml = "";
          }
        }
        contentHtml = segmentsHtml || `<div class="msg-text" style="position: relative;">${escapeHtml(displayContent)}</div>`;
      } else {
        // 单聊原有扁平非分割渲染 (支持思维链连同气泡一体化与防空气泡拦截)
      // 思维链优先读取独立 thought 字段；旧消息回退到从 content 解析
      let cotThoughtText = m.thought || "";
      let cotCleanContent = m.content;
      if (!cotThoughtText) {
        const parsedCotLegacy = parseThoughtFromText(m.content);
        cotThoughtText = parsedCotLegacy.thought;
        cotCleanContent = parsedCotLegacy.cleanText;
      }
      if (cotThoughtText) {
        const thoughtDiv = document.createElement("div");
        thoughtDiv.setAttribute("data-msg-id", m.id);
        thoughtDiv.style.cssText = "width: 100%; display: flex; justify-content: center; align-items: center; position: relative; margin: 4px 0;";
        
        thoughtDiv.ondblclick = (e) => {
          e.preventDefault();
          if (isMultiSelectMode) return;
          selectedMsgId = m.id;
          const btnRecall = document.getElementById("btn-menu-recall");
          if (btnRecall) btnRecall.style.display = "none";
          document.getElementById("bubble-context-menu").style.display = "flex";
        };

        thoughtDiv.innerHTML = `
          <div class="msg-select-checkbox" style="display: ${isMultiSelectMode ? 'flex' : 'none'}; margin-right: 6px; align-self: center;">
            <input type="checkbox" class="msg-checkbox" data-msg-id="${m.id}" onchange="updateSelectedCount()">
          </div>
          <div style="flex: 1; max-width: 90%; display: flex; justify-content: center;">
            ${buildCotThoughtCardHtml("cot-msg-" + m.id, cotThoughtText)}
          </div>
        `;
        fragment.appendChild(thoughtDiv);
      }

      let displayContent = cotCleanContent;
      // 核心防御：若清理后正文为空，直接跳过不渲染空气泡
      if (!displayContent) {
        continue;
      }

      const isOnlySticker = typeof displayContent === 'string' && /^【表情包：[^】]+】$/.test(displayContent.trim());
      let renderedSticker = displayContent;
      if (window.stickerSystem && window.stickerSystem.renderStickerInMessageSync) {
        renderedSticker = window.stickerSystem.renderStickerInMessageSync(displayContent, mountedGroupIds);
      }

      if (isOnlySticker && renderedSticker.includes('<img')) {
        contentHtml = `<div class="msg-sticker-alone-wrapper" style="position: relative;">${renderedSticker}${emojiHtml}</div>`;
      } else {
        let quoteHtml = "";
        if (window.quoteSystem) {
          const parsed = await window.quoteSystem.parseQuote(displayContent);
          if (parsed) {
            quoteHtml = parsed.quoteHtml;
            displayContent = parsed.cleanText;
          }
        }
        if (window.stickerSystem && window.stickerSystem.renderStickerInMessageSync) {
          displayContent = window.stickerSystem.renderStickerInMessageSync(displayContent, mountedGroupIds);
        }
        let translationHtml = "";
        if (m.translatedContent && m.showTranslation === 1) {
          translationHtml = `<div class="wechat-translation-block" style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.15); font-size:12px; color:#475569; text-align:justify; line-height:1.4;"><span style="font-size:10px; color:#0284c7; font-weight:700; margin-right:4px;">[译]</span>${escapeHtml(m.translatedContent)}</div>`;
        }
        contentHtml = `<div class="msg-text" style="position: relative;">${quoteHtml}${displayContent}${translationHtml}${emojiHtml}</div>`;
      }
      }
    }

    // 判断群聊发送人信息与头衔
    let finalSenderName = "";
    // 强制转型 Number 防止 Dexie 主键查询类型冲突失效
    let finalAvatarUrl = m.senderType === 'user' ? (user ? resolveAvatar(user.avatar) : userAvatarUrl) : charAvatarUrl;
    let roleTitleHtml = "";

    if (sess.isGroup === 1) {
      if (Number(m.senderId) === 99999) {
        // 核心支持：精准匹配并加载群助手机器人的专属名称与头像
        const groupObj = await db.groups.get(sess.groupId);
        const botObj = (groupObj && groupObj.bots && groupObj.bots.length > 0) ? groupObj.bots[0] : null;
        finalSenderName = botObj ? botObj.name : "群助手";
        finalAvatarUrl = (botObj && botObj.avatar) ? resolveAvatar(botObj.avatar) : "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%2364748b'/></svg>";
      } else {
        const memberInfo = await db.group_members.where('[groupId+memberId+memberType]').equals([sess.groupId, Number(m.senderId), m.senderType]).first();
        if (m.senderType === 'user') {
          finalSenderName = sess.customUserName || user?.name || "我";
        } else {
          const charSender = await db.archives.get(Number(m.senderId));
          finalSenderName = charSender ? (charSender.remark || charSender.name) : "群成员";
          finalAvatarUrl = charSender ? resolveAvatar(charSender.avatar) : finalAvatarUrl;
        }
        if (memberInfo && memberInfo.title) {
          const badgeColor = memberInfo.role === 'owner' ? '#ef4444' : (memberInfo.role === 'admin' ? '#3b82f6' : '#10b981');
          roleTitleHtml = `<span style="font-size:9px; background-color:${badgeColor}; color:#fff; padding:1px 4px; border-radius:4px; margin-right:4px; font-weight:700;">${escapeHtml(memberInfo.title)}</span>`;
        }
      }
    }

    // 针对旧 Service Worker 缓存遗留的 SVG 实体进行自愈转译，保障无符号残留
    if (finalAvatarUrl && finalAvatarUrl.includes('%22')) {
      finalAvatarUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='%23cbd5e1'/></svg>";
    }

    const blockedIconHtml = m.isBlocked === 1 ? `
      <div class="msg-blocked-icon" style="color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 4px; align-self: center; flex-shrink: 0;" title="消息未送达/对方已拒收">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" fill="#fff" stroke="#ef4444"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
    ` : "";

    // 群聊时气泡上方显示发送人名称 (己方也显示)
    const showSenderNameHtml = (sess.isGroup === 1) ? `
      <div class="group-sender-name">${roleTitleHtml}${escapeHtml(finalSenderName)}</div>
    ` : "";

    // 投票卡片内容定制拦截
    if (m.contentType === 'group_poll' && window.groupChatSystem) {
      const pollCard = await window.groupChatSystem.renderPollCardInMsg(m);
      fragment.appendChild(pollCard);
      continue;
    }

    // 核心自愈：包裹 msg-content-col 垂直列容器，彻底解决 CoT 与气泡横向挤压排列的 BUG
        let bubbleBodyHtml = "";
        const alignStyle = m.senderType === 'user' ? 'align-items: flex-end;' : 'align-items: flex-start;';

        if (sess.isGroup === 1) {
          bubbleBodyHtml = `
            <div class="group-msg-wrapper" style="display: flex; flex-direction: column; ${alignStyle}">
              ${showSenderNameHtml}
              ${contentHtml}
            </div>
          `;
        } else {
          bubbleBodyHtml = `
            <div class="msg-content-col" style="display: flex; flex-direction: column; ${alignStyle} max-width: 80%; gap: 4px; flex: 1;">
              ${contentHtml}
            </div>
          `;
        }

    bubble.innerHTML = `
      <div class="msg-select-checkbox" style="display: ${isMultiSelectMode ? 'flex' : 'none'};">
        <input type="checkbox" class="msg-checkbox" data-msg-id="${m.id}" onchange="updateSelectedCount()">
      </div>
      <img class="msg-avatar" src="${finalAvatarUrl}">
      ${bubbleBodyHtml}
      ${blockedIconHtml}
    `;
    fragment.appendChild(bubble);

    // 生图图片消息：单击展开全屏大图，双击收藏到收藏室-图片
    // 仅对真实图片（isRealImage）绑定，使用计时器区分单击/双击
    if (m.contentType === 'image') {
      const imgEl = bubble.querySelector('img.msg-img[data-img-url]');
      if (imgEl) {
        let clickTimer = null;
        const imgUrl = imgEl.getAttribute('data-img-url') || imgEl.src;
        imgEl.style.cursor = 'zoom-in';

        // 获取图片描述文字（用于大图视图展示和收藏）
        let imgDescription = '';
        try {
          const dataObj = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          imgDescription = dataObj?.text || '';
        } catch(e) {}

        // 获取高清图地址（如果消息里存了 hdUrl 字段）
        let hdUrl = '';
        try {
          const dataObj = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          hdUrl = dataObj?.hdUrl || '';
        } catch(e) {}

        imgEl.onclick = (e) => {
          e.stopPropagation();
          if (clickTimer) {
            // 双击：打开工具栏（从工具栏里才可以收藏）
            clearTimeout(clickTimer);
            clickTimer = null;
            showImageToolbar(m.id, imgUrl, { description: imgDescription, hdUrl, msgId: m.id });
          } else {
            clickTimer = setTimeout(() => {
              clickTimer = null;
              // 单击：展开全屏大图（带描述、高清图懒加载）
              if (window.imageGenSystem && typeof window.imageGenSystem.openFullScreenImage === 'function') {
                window.imageGenSystem.openFullScreenImage(imgUrl, {
                  description: imgDescription,
                  msgId: m.id,
                  hdSrc: hdUrl || imgUrl
                });
              }
            }, 250);
          }
        };
        // 阻止双击触发 bubble 的上下文菜单
        imgEl.ondblclick = (e) => { e.stopPropagation(); };
      }
    }
  }

  if (isInitial) {
    container.innerHTML = "";
    container.appendChild(fragment);

    if (isRefresh && savedAnchorMsgId && !wasNearBottom) {
      // 操作后刷新且用户不在底部：精准滚动回之前可见的首条消息位置
      const anchorEl = container.querySelector(`[data-msg-id="${savedAnchorMsgId}"]`);
      if (anchorEl) {
        container.scrollTop = anchorEl.offsetTop - container.offsetTop - 4;
      } else {
        container.scrollTop = container.scrollHeight;
      }
    } else {
      // 全新打开会话或用户在底部：滚动到底部
      container.scrollTop = container.scrollHeight;
    }
  } else {
    // 向上滑动加载时，精准锚定视角高度差，防止滚动条蹦跳
    const oldScrollHeight = container.scrollHeight;
    container.insertBefore(fragment, container.firstChild);
    container.scrollTop = container.scrollHeight - oldScrollHeight;
  }
}

// 动态追加消息
async function appendMessageToDOM(msg) {
  const container = document.getElementById("dialog-messages-container");
  if (!container) return;

  // 通话中的对白消息（带 callId）不上屏，只在通话记录卡片内查看
  if (msg && msg.callId) return;

  // 会话隔离：如果消息不属于当前活跃会话，不渲染到 DOM（消息已存库，切换回时会显示）
  if (msg && msg.sessionId != null && msg.sessionId !== activeSessionId) return;

  // 残留标签清洗：文本消息含 [图片描述: xxx] / [图片: xxx] 时升级为图片消息
  if (msg && msg.contentType === 'text' && msg.content && /\[[^\]]*图片[^\]]*\]/.test(msg.content)) {
    const matched = msg.content.match(/[\[【]\s*图片(?:描述)?\s*[:：]\s*([\s\S]*?)[\]】]/);
    if (matched) {
      msg._originalContent = msg.content;
      msg.contentType = 'image';
      msg.content = JSON.stringify({ url: '', text: matched[1].trim(), legacyTag: true });
    }
  }

  const sess = await db.sessions.get(msg?.sessionId || activeSessionId);
  const user = await db.archives.get(sess.userId); // 补全 user 异步读取，彻底根治 user is not defined 异常 [1]
  
  // 补全头像与表情局部变量加载，彻底根治 charAvatarUrl 与 emojiHtml 未初始化异常
  const charAvatarUrl = resolveAvatar(activeSessionCharAvatar);
  const userAvatarUrl = resolveAvatar(activeSessionUserAvatar);
  const emojiHtml = msg.reactionEmoji ? `<div class="bubble-attached-emoji" onclick="window.removeReaction(${msg.id}, event)">${msg.reactionEmoji}</div>` : "";

  const sidForQuery = msg?.sessionId || activeSessionId;
  const msgs = await db.messages.where('sessionId').equals(sidForQuery).sortBy('timestamp');
  const prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;

  const currentDisplayTime = getMessageDisplayDate(msg, sess);
  let showTimestamp = false;
  if (!prevMsg) {
    showTimestamp = true;
  } else {
    const prevDisplayTime = getMessageDisplayDate(prevMsg, sess);
    const diff = currentDisplayTime.getTime() - prevDisplayTime.getTime();
    if (diff > 3 * 60 * 1000) {
      showTimestamp = true;
    }
  }

  if (showTimestamp) {
    const timeDiv = document.createElement("div");
    timeDiv.className = "chat-time-divider";
    timeDiv.style.cssText = "text-align: center; margin: 12px 0; font-size: 11.5px; color: #b2b2b2; user-select: none;";
    timeDiv.innerText = formatWeChatTime(currentDisplayTime, getSimulatedNow(sess));
    container.appendChild(timeDiv);
  }

  // 核心支持：将 senderType === 'system' 的追加消息渲染为微信中间灰字
  // 注意：contentType === 'call' / 'social_notice' 的卡片需走专用渲染分支，不能在此当纯文本显示
  if (msg.senderType === 'system' && msg.contentType !== 'call' && msg.contentType !== 'social_notice') {
    const sysEl = document.createElement("div");
    sysEl.className = "group-system-notice-container";
    sysEl.setAttribute("data-msg-id", msg.id);
    sysEl.style.cssText = "display: flex; justify-content: center; align-items: center; width: 100%; margin: 8px 0; box-sizing: border-box; padding: 0 16px;";
    sysEl.innerHTML = `
      <div style="background-color: rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 4px; font-size: 11px; color: #7f7f7f; user-select: none; max-width: 85%; text-align: center; line-height: 1.4;">
        ${escapeHtml(msg.content)}
      </div>
    `;
    container.appendChild(sysEl);
    container.scrollTop = container.scrollHeight;
    return;
  }

  if (msg.isRecalled === 1) {
    const recallEl = document.createElement("div");
    recallEl.className = "recalled-system-msg-container";
    recallEl.setAttribute("data-msg-id", msg.id);
    recallEl.style.cssText = "display: flex; justify-content: center; align-items: center; width: 100%; margin: 8px 0; box-sizing: border-box; padding: 0 16px;";
    recallEl.innerHTML = `
      <div style="background-color: rgba(0,0,0,0.05); padding: 6px 12px; border-radius: 4px; font-size: 11.5px; color: #999; user-select: none; max-width: 85%; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center;">
        <div style="pointer-events: none;">
          ${msg.senderType === 'user' ? '你' : '对方'} 撤回了一条消息 
          <span class="recall-view-btn" style="color: #576b95; font-size: 10.5px; margin-left: 4px; cursor: pointer; pointer-events: auto;" onclick="window.toggleRecallContent(this, event)">查看</span>
        </div>
        <div class="recall-original-content" style="display: none; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 4px; margin-top: 4px; color: #666; font-size: 11px; word-break: break-all; width: 100%; text-align: left;">
          ${escapeHtml(msg.content)}
        </div>
      </div>
    `;
    recallEl.ondblclick = (e) => {
      e.preventDefault();
      if (isMultiSelectMode) return;
      selectedMsgId = msg.id;
      
      if (window.momentShareClickTimer) {
        clearTimeout(window.momentShareClickTimer);
        window.momentShareClickTimer = null;
      }
      
      const btnRecall = document.getElementById("btn-menu-recall");
      if (btnRecall) btnRecall.style.display = "none";
      
      document.getElementById("bubble-context-menu").style.display = "flex";
    };
    container.appendChild(recallEl);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${msg.senderType === 'user' ? 'self' : 'other'}`;
  bubble.setAttribute("data-msg-id", msg.id);
  bubble.style.position = "relative";

  bubble.ondblclick = async (e) => {
    e.preventDefault();
    if (isMultiSelectMode) return;
    selectedMsgId = msg.id;
    
    if (window.momentShareClickTimer) {
      clearTimeout(window.momentShareClickTimer);
      window.momentShareClickTimer = null;
    }
    
    const dbMsg = await db.messages.get(msg.id);
    const btnRecall = document.getElementById("btn-menu-recall");
    if (btnRecall && dbMsg) {
      const isUserMsg = dbMsg.senderType === 'user';
      if (isUserMsg && !dbMsg.isRecalled) {
        btnRecall.style.display = "block";
      } else {
        btnRecall.style.display = "none";
      }
    }
    
    document.getElementById("bubble-context-menu").style.display = "flex";
  };

  bubble.onmousedown = (e) => startBubbleLongPress(msg.id, bubble, e);
  bubble.onmouseup = (e) => cancelBubbleLongPress(e);
  bubble.onmouseleave = (e) => cancelBubbleLongPress(e);
  bubble.ontouchstart = (e) => startBubbleLongPress(msg.id, bubble, e);
  bubble.ontouchend = (e) => cancelBubbleLongPress(e);
  
  // 预加载当前对话的表情包挂载配置
  let mountedGroupIds = [];
  if (window.stickerSystem && window.stickerSystem.getMountedGroupIds) {
    mountedGroupIds = await window.stickerSystem.getMountedGroupIds(activeSessionId);
  }
  
  let contentHtml = "";
  if (msg.contentType === 'image') {
    try {
      const data = JSON.parse(msg.content);
      const captionText = data.text || "场景画面";
      const isGenerating = data.generating === true;
      const isRealImage = data.url && data.url.startsWith("data:image/") && !data.url.includes("svg+xml");

      let imgTransHtml = escapeHtml(captionText);
      if (msg.translatedContent && msg.showTranslation === 1) {
        imgTransHtml += `<div style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(0,0,0,0.15); font-size:11.5px; color:#0284c7; text-align:justify;"><span style="font-weight:700; margin-right:3px;">[译]</span>${escapeHtml(msg.translatedContent)}</div>`;
      }

      if (isGenerating) {
        contentHtml = `
          <div class="msg-image-placeholder-card" style="padding:18px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:18px; height:18px; border:2.5px solid var(--border); border-top-color:#ec4899; border-radius:50%; animation:imagegen-spin 0.8s linear infinite; flex-shrink:0;"></div>
              <span style="font-size:12.5px; color:var(--text-secondary); font-weight:600;">正在生成图片…</span>
            </div>
          </div>
        `;
      } else if (isRealImage) {
        // 双存储：小图用 data.url（压缩缩略图），大图视图用 data.hdUrl（高清原图）
        const imgSrc = data.url || '';
        const hdSrc = data.hdUrl || imgSrc;
        const safeImgSrc = imgSrc.replace(/"/g, '&quot;');
        contentHtml = `
          <div class="image-bubble-card" onclick="toggleImageText(${msg.id}, this)">
            <img src="${imgSrc}" class="msg-img" data-img-url="${safeImgSrc}" data-hd-url="${hdSrc.replace(/"/g, '&quot;')}" onerror="this.style.display='none'; document.getElementById('img-fallback-${msg.id}').style.display='flex';">
            <div id="img-fallback-${msg.id}" class="msg-image-placeholder-card" style="display:none; width: 100%;">
              <div class="msg-image-placeholder-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span class="msg-image-placeholder-title">发送了画面图片</span>
              </div>
              <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
            </div>
            <div class="image-description-text" id="image-desc-${msg.id}" style="display: ${msg.showTranslation === 1 ? 'block' : 'none'}; max-height: 120px; overflow-y: auto;">
              ${imgTransHtml}
            </div>
          </div>
        `;
      } else {
        contentHtml = `
          <div class="msg-image-placeholder-card" onclick="toggleImageText(${msg.id}, this)">
            <div class="msg-image-placeholder-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span class="msg-image-placeholder-title">发送了画面图片</span>
            </div>
            <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
            <div class="image-description-text" id="image-desc-${msg.id}" style="display: ${msg.showTranslation === 1 ? 'block' : 'none'}; max-height: 120px; overflow-y: auto; margin-top:8px;">
              ${imgTransHtml}
            </div>
          </div>
        `;
      }
    } catch(e) {
      contentHtml = `
        <div class="msg-image-placeholder-card" onclick="toggleImageText(${msg.id}, this)">
          <div class="msg-image-placeholder-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary); flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span class="msg-image-placeholder-title">发送了画面图片</span>
          </div>
          <div class="msg-image-placeholder-sub">轻触可展示具体画面场景描述</div>
          <div class="image-description-text" id="image-desc-${msg.id}" style="display: ${msg.showTranslation === 1 ? 'block' : 'none'}; max-height: 120px; overflow-y: auto; margin-top:8px;">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
    }
  } else if (msg.contentType === 'voice') {
    try {
      const data = JSON.parse(msg.content);
      const width = Math.min(180, 75 + data.duration * 2);
      const align = msg.senderType === 'user' ? 'flex-end' : 'flex-start';

      let voiceTransHtml = escapeHtml(data.text);
      if (msg.translatedContent && msg.showTranslation === 1) {
        voiceTransHtml += `<div style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(0,0,0,0.15); font-size:11.5px; color:#0284c7; text-align:justify;"><span style="font-weight:700; margin-right:3px;">[译]</span>${escapeHtml(msg.translatedContent)}</div>`;
      }

      contentHtml = `
        <div style="display:flex; flex-direction:column; align-items: ${align}; gap:4px; max-width:220px;">
          <div class="voice-bubble-card" onclick="toggleVoiceTranslation(${msg.id}, this)" style="width: ${width}px;">
            <div class="voice-bubble-wave">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;">
                <path d="M12 1v22M17 5v14M22 9v6M7 5v14M2 9v6"/>
              </svg>
            </div>
            <div class="voice-bubble-duration">${data.duration}"</div>
          </div>
          <div class="voice-translation-text" id="voice-trans-${msg.id}" style="display: ${msg.showTranslation === 1 ? 'block' : 'none'};">
            ${voiceTransHtml}
          </div>
        </div>
      `;
    } catch(e) {
      contentHtml = `<div class="msg-text">语音格式异常</div>`;
    }
  } else if (msg.contentType === 'transfer') {
    try {
      const data = JSON.parse(msg.content);
      const amount = parseFloat(data.amount) || 0;
      const statusClass = data.status || 'pending';
      const statusLabel = statusClass === 'received' ? '已收钱' : '待接收';
      const targetLabel = data.targetName ? `（给 ${escapeHtml(data.targetName)}）` : "";
      contentHtml = `
        <div class="wallet-bubble-card transfer ${statusClass}" onclick="walletSystem.claimTransfer(${msg.id})" style="position: relative;">
          <div class="wallet-bubble-body">
            <div class="wallet-bubble-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" ry="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <div class="wallet-bubble-details">
              <div class="wallet-bubble-title">微信转账 ${targetLabel}</div>
              <div class="wallet-bubble-amount">¥ ${amount.toFixed(2)}</div>
            </div>
          </div>
          <div class="wallet-bubble-footer">${statusLabel}</div>
        </div>
      `;
    } catch(e) {
      contentHtml = `<div class="msg-text">转账格式错误</div>`;
    }
  } else if (msg.contentType === 'red_envelope') {
    try {
      const data = JSON.parse(msg.content);
      const amount = parseFloat(data.amount) || 0;
      const remark = escapeHtml(data.remark || '恭喜发财，大吉大利');
      const isLucky = data.type === 'lucky';
      const typeLabel = isLucky ? ' 拼手气' : '';
      const statusClass = data.status || 'pending';
      const statusLabel = statusClass === 'opened' ? `微信${typeLabel}红包（已领取）` : `微信${typeLabel}红包`;
      contentHtml = `
        <div class="wallet-bubble-card red-envelope ${statusClass}" onclick="walletSystem.claimRedEnvelope(${msg.id})" style="position: relative;">
          <div class="wallet-bubble-body">
            <div class="wallet-bubble-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <div class="wallet-bubble-details">
              <div class="wallet-bubble-title">${remark}</div>
              <div class="wallet-bubble-desc">查看红包</div>
            </div>
          </div>
          <div class="wallet-bubble-footer">${statusLabel}</div>
        </div>
      `;
    } catch(e) {
      contentHtml = `<div class="msg-text">红包格式错误</div>`;
    }
  } else if (msg.contentType === 'location') {
    try {
      const locData = JSON.parse(msg.content);
      contentHtml = buildLocationCardHtml(locData, msg.id);
    } catch(e) {
      contentHtml = `<div style="font-size:13px; color:#999;">[位置消息解析失败]</div>`;
    }
  } else if (msg.contentType === 'pay_for_me' || msg.contentType === 'gift') {
    try {
      const cardData = JSON.parse(msg.content);
      const isGift = msg.contentType === 'gift';
      const isPaid = cardData.status === 'paid';
      const titleText = isGift ? '礼物小票' : '代付请求';
      const itemsHtml = (cardData.items || []).map(item =>
        `<div style="display:flex; justify-content:space-between; font-size:11px; padding:2px 0;"><span style="color:#333;">${escapeHtml(item.name || item.title || '商品')} x${item.quantity || 1}</span><span style="color:#333;">¥${(item.price || 0).toFixed(2)}</span></div>`
      ).join('');
      contentHtml = `
        <div class="receipt-bubble-card" style="width:240px; background:#fff; border-radius:8px; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <div style="background:${isGift ? '#1a1a2e' : '#000'}; color:#fff; padding:8px 12px; text-align:center; font-size:12px; font-weight:700; letter-spacing:1px;">${titleText}</div>
          <div style="padding:10px 12px; border-bottom:1px dashed #eee;">
            ${itemsHtml || '<div style="font-size:11px; color:#999; text-align:center; padding:4px;">暂无商品明细</div>'}
          </div>
          ${cardData.message ? `<div style="padding:8px 12px; border-bottom:1px dashed #eee; font-size:11px; color:#666; font-style:italic;">"${escapeHtml(cardData.message)}"</div>` : ''}
          <div style="padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#999;">合计</span>
            <span style="font-size:16px; font-weight:700; color:#000;">¥${(cardData.total || 0).toFixed(2)}</span>
          </div>
          <div style="padding:6px 12px 10px; text-align:center;">
            ${isGift
              ? `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#e8e8e8; color:#666;">${isPaid ? '已查收' : '一份心意'}</span>`
              : isPaid
                ? `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#1a1a2e; color:#fff;">已付款</span>`
                : `<span style="display:inline-block; padding:3px 10px; font-size:10px; font-weight:700; border-radius:4px; background:#fff3e0; color:#ff6b35; border:1px solid #ff6b35;">待付款</span>`
            }
          </div>
        </div>
      `;
    } catch(e) {
      contentHtml = `<div style="font-size:13px; color:#999;">[${msg.contentType === 'gift' ? '礼物' : '代付'}消息解析失败]</div>`;
    }
  } else if (msg.contentType === 'withdraw_share') {
    try {
      const data = JSON.parse(msg.content);
      const linkText = data.linkText || '【提现助力】帮我点一下';
      contentHtml = `<div class="withdraw-share-link" style="color:#576b95; text-decoration:underline; word-break:break-all; font-size:14px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(linkText)}</div>`;
    } catch(e) {
      contentHtml = `<div style="font-size:13px; color:#999;">[分享链接]</div>`;
    }
  } else if (msg.contentType === 'moment_share') {
    try {
      const data = JSON.parse(msg.content);
      contentHtml = `
        <div class="wallet-bubble-card" style="background-color: #ffffff; border: 1.5px solid var(--border); border-radius: 8px; width: 220px; cursor: pointer; position: relative;" onclick="window.safeOpenMomentFromShare(${data.momentId}, event)">
          <div class="wallet-bubble-body" style="padding: 10px; display: flex; flex-direction: column; gap: 4px;">
            <div style="font-size: 11px; color: var(--text-secondary); font-weight:700;">转发了朋友圈动态</div>
            <div style="font-size: 13px; font-weight: 700; color: #1e293b; border-bottom: 1.5px dashed var(--border); padding-bottom: 6px;">
              ${data.authorName} 的朋友圈
            </div>
            <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px; font-style: italic;">
              “ ${escapeHtml(data.summary)} ”
            </div>
            ${data.commentText ? `<div style="font-size: 12px; color: #576b95; margin-top: 6px; font-weight:700;">附言：${escapeHtml(data.commentText)}</div>` : ''}
          </div>
          <div style="background-color: #fafbfc; font-size: 10px; padding: 6px 10px; border-top: 1px solid var(--border); text-align: right; color: var(--text-secondary); border-radius: 0 0 8px 8px;">轻触在朋友圈中查看</div>
        </div>
      `;
    } catch(e) {
      contentHtml = `<div class="msg-text">朋友圈分享格式错误</div>`;
    }
  } else if (msg.contentType === 'mcp_tool') {
    try {
      const toolData = JSON.parse(msg.content);
      const cardHtml = buildMcpToolCardHtml(msg.id, toolData);
      const tempDiv = document.createElement("div");
      tempDiv.style.cssText = "width: 100%; display: flex; justify-content: center;";
      tempDiv.innerHTML = cardHtml;
      tempDiv.setAttribute("data-msg-id", msg.id);
      container.appendChild(tempDiv);
      const _d = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (_d < 150) container.scrollTop = container.scrollHeight;
      return;
    } catch(e) {}
  } else if (msg.contentType === 'social_notice') {
    // 社交动作跳转卡片（追加渲染分支）
    try {
      const data = JSON.parse(msg.content);
      const cardEl = buildSocialNoticeCard(data);
      cardEl.setAttribute("data-msg-id", msg.id);
      container.appendChild(cardEl);
    } catch(e) {
      const sysEl = document.createElement("div");
      sysEl.className = "group-system-notice-container";
      sysEl.setAttribute("data-msg-id", msg.id);
      sysEl.style.cssText = "display: flex; justify-content: center; width: 100%; margin: 8px 0; padding: 0 16px;";
      sysEl.innerHTML = `<div style="background-color: rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 4px; font-size: 11px; color: #7f7f7f; max-width: 85%; text-align: center;">${escapeHtml(msg.content)}</div>`;
      container.appendChild(sysEl);
    }
    const _d3 = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (_d3 < 150) container.scrollTop = container.scrollHeight;
    return;
  } else if (msg.contentType === 'call') {
    // 通话记录系统卡片：居中灰底，可点击展开查看通话对话记录并反复播放 TTS
    if (window.callSystem && typeof window.callSystem.renderCallRecordCard === "function") {
      const cardWrap = window.callSystem.renderCallRecordCard(msg);
      cardWrap.setAttribute("data-msg-id", msg.id);
      container.appendChild(cardWrap);
      const _d2 = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (_d2 < 150) container.scrollTop = container.scrollHeight;
    }
    return;
  } else {
    // 核心解耦：仅群聊会话支持表情包自动分割气泡；单聊会话 100% 保持原有不分割扁平布局，防止其被搞坏
    if (sess && sess.isGroup === 1) {
      const rawContent = msg.content;
      let quoteHtml = "";
      let displayContent = rawContent;
      if (window.quoteSystem) {
        const parsed = await window.quoteSystem.parseQuote(rawContent);
        if (parsed) {
          quoteHtml = parsed.quoteHtml;
          displayContent = parsed.cleanText;
        }
      }

      const stickerRegex = /(【表情包：[^】]+】)/g;
      const parts = displayContent.split(stickerRegex).filter(Boolean);
      
      let segmentsHtml = "";
      for (const part of parts) {
        if (part.startsWith("【表情包：") && part.endsWith("】")) {
          const stickerImgHtml = window.stickerSystem ? window.stickerSystem.renderStickerInMessageSync(part, mountedGroupIds) : part;
          if (stickerImgHtml.includes("<img")) {
            segmentsHtml += `<div class="msg-sticker-alone-wrapper" style="position: relative; margin-top: 4px; display: block;">${stickerImgHtml}${emojiHtml}</div>`;
          } else {
            segmentsHtml += `<div class="msg-text" style="position: relative; margin-top: 4px; display: block;">${escapeHtml(part)}${emojiHtml}</div>`;
          }
        } else {
          let textNode = window.stickerSystem ? window.stickerSystem.renderStickerInMessageSync(part, mountedGroupIds) : part;
          segmentsHtml += `<div class="msg-text" style="position: relative; margin-top: 4px; display: block;">${quoteHtml}${textNode}${emojiHtml}</div>`;
          quoteHtml = "";
        }
      }
      contentHtml = segmentsHtml || `<div class="msg-text" style="position: relative;">${escapeHtml(displayContent)}</div>`;
    } else {
      // 单聊原有扁平非分割追加渲染 (支持思维链连同气泡一体化与防空气泡拦截)
      // 思维链优先读取独立 thought 字段；旧消息回退到从 content 解析
      let cotThoughtText = msg.thought || "";
      let cotCleanContent = msg.content;
      if (!cotThoughtText) {
        const parsedCotLegacy = parseThoughtFromText(msg.content);
        cotThoughtText = parsedCotLegacy.thought;
        cotCleanContent = parsedCotLegacy.cleanText;
      }
      if (cotThoughtText) {
        const thoughtDiv = document.createElement("div");
        thoughtDiv.setAttribute("data-msg-id", msg.id);
        thoughtDiv.style.cssText = "width: 100%; display: flex; justify-content: center; align-items: center; position: relative; margin: 4px 0;";

        thoughtDiv.ondblclick = (e) => {
          e.preventDefault();
          if (isMultiSelectMode) return;
          selectedMsgId = msg.id;
          const btnRecall = document.getElementById("btn-menu-recall");
          if (btnRecall) btnRecall.style.display = "none";
          document.getElementById("bubble-context-menu").style.display = "flex";
        };

        thoughtDiv.innerHTML = `
          <div class="msg-select-checkbox" style="display: ${isMultiSelectMode ? 'flex' : 'none'}; margin-right: 6px; align-self: center;">
            <input type="checkbox" class="msg-checkbox" data-msg-id="${msg.id}" onchange="updateSelectedCount()">
          </div>
          <div style="flex: 1; max-width: 90%; display: flex; justify-content: center;">
            ${buildCotThoughtCardHtml("cot-append-" + (msg.id || Date.now()), cotThoughtText)}
          </div>
        `;
        container.appendChild(thoughtDiv);
      }

      let displayContent = cotCleanContent;
      // 核心防御：若清理后正文为空，直接返回不渲染空气泡
      if (!displayContent) {
        container.scrollTop = container.scrollHeight;
        return;
      }

      const isOnlySticker = typeof displayContent === 'string' && /^【表情包：[^】]+】$/.test(displayContent.trim());
      let renderedSticker = displayContent;
      if (window.stickerSystem && window.stickerSystem.renderStickerInMessageSync) {
        renderedSticker = window.stickerSystem.renderStickerInMessageSync(displayContent, mountedGroupIds);
      }
      
      if (isOnlySticker && renderedSticker.includes('<img')) {
        contentHtml = `<div class="msg-sticker-alone-wrapper" style="position: relative; margin-top: 4px; display: block;">${renderedSticker}</div>`;
      } else {
        let quoteHtml = "";
        if (window.quoteSystem) {
          const parsed = await window.quoteSystem.parseQuote(displayContent);
          if (parsed) {
            quoteHtml = parsed.quoteHtml;
            displayContent = parsed.cleanText;
          }
        }
        if (window.stickerSystem && window.stickerSystem.renderStickerInMessageSync) {
          displayContent = window.stickerSystem.renderStickerInMessageSync(displayContent, mountedGroupIds);
        }
        contentHtml = `<div class="msg-text" style="position: relative; margin-top: 4px; display: block;">${quoteHtml}${displayContent}</div>`;
      }
    }
  }

// 支撑追加消息时的群聊视图渲染
      let finalSenderName = "";
      let finalAvatarUrl = msg.senderType === 'user' ? (user ? resolveAvatar(user.avatar) : userAvatarUrl) : charAvatarUrl;
      let roleTitleHtml = "";

      if (sess && sess.isGroup === 1) {
        if (Number(msg.senderId) === 99999) {
          const groupObj = await db.groups.get(sess.groupId);
          const botObj = (groupObj && groupObj.bots && groupObj.bots.length > 0) ? groupObj.bots[0] : null;
          finalSenderName = botObj ? botObj.name : "群助手";
          finalAvatarUrl = (botObj && botObj.avatar) ? resolveAvatar(botObj.avatar) : "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%2364748b'/></svg>";
        } else {
          const memberInfo = await db.group_members.where('[groupId+memberId+memberType]').equals([sess.groupId, Number(msg.senderId), msg.senderType]).first();
          if (msg.senderType === 'user') {
            finalSenderName = sess.customUserName || user?.name || "我";
          } else {
            const charSender = await db.archives.get(Number(msg.senderId));
            finalSenderName = charSender ? (charSender.remark || charSender.name) : "群成员";
            finalAvatarUrl = charSender ? resolveAvatar(charSender.avatar) : finalAvatarUrl;
          }
          if (memberInfo && memberInfo.title) {
            const badgeColor = memberInfo.role === 'owner' ? '#ef4444' : (memberInfo.role === 'admin' ? '#3b82f6' : '#10b981');
            roleTitleHtml = `<span style="font-size:9px; background-color:${badgeColor}; color:#fff; padding:1px 4px; border-radius:4px; margin-right:4px; font-weight:700;">${escapeHtml(memberInfo.title)}</span>`;
          }
        }
      }

  // 针对旧 Service Worker 缓存遗留的 SVG 实体进行自愈转译，保障无符号残留
  if (finalAvatarUrl && finalAvatarUrl.includes('%22')) {
    finalAvatarUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='%23cbd5e1'/></svg>";
  }
  
  let finalContentHtml = contentHtml;
  if (msg.contentType === 'image') {
    finalContentHtml = contentHtml.replace('class="image-bubble-card"', 'class="image-bubble-card" style="position: relative;"').replace('class="msg-image-placeholder-card"', 'class="msg-image-placeholder-card" style="position: relative;"') + emojiHtml;
  } else if (msg.contentType === 'voice') {
    finalContentHtml = contentHtml.replace('class="voice-bubble-card"', 'class="voice-bubble-card" style="position: relative;"').replace('class="voice-bubble-card"', 'class="voice-bubble-card" style="position: relative;"') + emojiHtml;
  } else if (msg.contentType === 'transfer' || msg.contentType === 'red_envelope' || msg.contentType === 'moment_share') {
    // 关键修复：之前用 .replace('class="wallet-bubble-card', ...) 会在 wallet-bubble-card 后插入 "
    // 导致 class 属性提前闭合，transfer/red-envelope/pending 等状态类被丢弃，卡片失去橙红背景变灰
    // 现在所有 wallet-bubble-card 模板已内联 style="position: relative;"，无需再 replace
    finalContentHtml = contentHtml + emojiHtml;
  } else {
    finalContentHtml = contentHtml.replace('class="msg-text"', 'class="msg-text" style="position: relative;"').replace('class="msg-sticker-alone-wrapper"', 'class="msg-sticker-alone-wrapper" style="position: relative;"') + emojiHtml;
  }

  const blockedIconHtml = msg.isBlocked === 1 ? `
    <div class="msg-blocked-icon" style="color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 4px; align-self: center; flex-shrink: 0;" title="消息未送达/对方已拒收">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" fill="#fff" stroke="#ef4444"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
  ` : "";

  const showSenderNameHtml = (sess && sess.isGroup === 1) ? `
        <div class="group-sender-name">${roleTitleHtml}${escapeHtml(finalSenderName)}</div>
      ` : "";

      // 核心自愈：包裹 msg-content-col 垂直列容器，彻底解决 CoT 与气泡横向挤压排列的 BUG
      let bubbleBodyHtml = "";
      const alignStyle = msg.senderType === 'user' ? 'align-items: flex-end;' : 'align-items: flex-start;';

      if (sess && sess.isGroup === 1) {
        bubbleBodyHtml = `
          <div class="group-msg-wrapper" style="display: flex; flex-direction: column; ${alignStyle}">
            ${showSenderNameHtml}
            ${finalContentHtml}
          </div>
        `;
      } else {
        bubbleBodyHtml = `
          <div class="msg-content-col" style="display: flex; flex-direction: column; ${alignStyle} max-width: 80%; gap: 4px; flex: 1;">
            ${finalContentHtml}
          </div>
        `;
      }

  bubble.innerHTML = `
    <div class="msg-select-checkbox" style="display: ${isMultiSelectMode ? 'flex' : 'none'};">
      <input type="checkbox" class="msg-checkbox" data-msg-id="${msg.id}" onchange="updateSelectedCount()">
    </div>
    <img class="msg-avatar" src="${finalAvatarUrl}">
    ${bubbleBodyHtml}
    ${blockedIconHtml}
  `;
  container.appendChild(bubble);

  // 图片消息：绑定单击全屏大图 / 双击工具栏交互
  if (msg.contentType === 'image') {
    const imgEl = bubble.querySelector('img.msg-img[data-img-url]');
    if (imgEl) {
      let clickTimer = null;
      const imgUrl = imgEl.getAttribute('data-img-url') || imgEl.src;
      const hdUrlAttr = imgEl.getAttribute('data-hd-url') || imgUrl;
      imgEl.style.cursor = 'zoom-in';

      // 获取图片描述文字（用于大图视图展示和收藏）
      let imgDescription = '';
      let hdUrlFromData = '';
      try {
        const dataObj = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        imgDescription = dataObj?.text || '';
        hdUrlFromData = dataObj?.hdUrl || '';
      } catch(e) {}
      const finalHdUrl = hdUrlFromData || hdUrlAttr;

      imgEl.onclick = (e) => {
        e.stopPropagation();
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          // 双击：打开工具栏
          if (window.imageGenSystem && typeof window.imageGenSystem.showImageToolbar === 'function') {
            window.imageGenSystem.showImageToolbar(msg.id, imgUrl, { description: imgDescription, hdUrl: finalHdUrl, msgId: msg.id });
          }
        } else {
          clickTimer = setTimeout(() => {
            clickTimer = null;
            // 单击：展开全屏大图（带描述、高清图懒加载）
            if (window.imageGenSystem && typeof window.imageGenSystem.openFullScreenImage === 'function') {
              window.imageGenSystem.openFullScreenImage(imgUrl, {
                description: imgDescription,
                msgId: msg.id,
                hdSrc: finalHdUrl
              });
            }
          }, 250);
        }
      };
      imgEl.ondblclick = (e) => { e.stopPropagation(); };
    }
  }

  // 仅在用户已在底部附近时才自动滚动到底部，避免打断查看历史消息
  const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (distFromBottom < 150) {
    container.scrollTop = container.scrollHeight;
  }
}

// 回溯重回要求输入卡片：返回用户输入的要求文本（空字符串表示不输入要求），null 表示取消
function showRerollRequirementCard() {
  return new Promise((resolve) => {
    // 先注入专属 CSS
    let styleEl = document.getElementById("reroll-card-css");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "reroll-card-css";
      styleEl.textContent = `
        .reroll-card-mask {
          position: fixed !important; top: 0 !important; left: 0 !important;
          width: 100vw !important; height: 100vh !important;
          z-index: 100005 !important;
          background: rgba(0,0,0,0.5) !important;
          display: flex !important; align-items: center !important; justify-content: center !important;
          animation: rerollFadeIn 0.15s ease;
        }
        @keyframes rerollFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .reroll-card-box {
          background: #fff; border-radius: 16px; padding: 20px;
          width: 320px; max-width: 90vw;
          box-shadow: 0 10px 40px rgba(0,0,0,0.25);
          animation: rerollSlideIn 0.2s ease;
        }
        @keyframes rerollSlideIn { from { opacity: 0; transform: translateY(-12px) scale(0.96); } to { opacity: 1; transform: none; } }
        .reroll-card-title {
          font-size: 15px; font-weight: 700; color: #0f172a;
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
        }
        .reroll-card-desc {
          font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 14px;
        }
        .reroll-card-textarea {
          width: 100%; min-height: 72px; max-height: 140px;
          border: 1.5px solid #e2e8f0; border-radius: 10px;
          padding: 10px 12px; font-size: 13px; color: #0f172a;
          resize: none; outline: none; box-sizing: border-box;
          font-family: inherit; line-height: 1.5;
          transition: border-color 0.15s;
        }
        .reroll-card-textarea:focus { border-color: #6366f1; }
        .reroll-card-textarea::placeholder { color: #cbd5e1; }
        .reroll-card-actions {
          display: flex; gap: 10px; margin-top: 14px;
        }
        .reroll-card-btn {
          flex: 1; padding: 10px 0; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          border: none; transition: all 0.15s;
        }
        .reroll-card-btn-cancel {
          background: #f1f5f9; color: #64748b;
        }
        .reroll-card-btn-cancel:hover { background: #e2e8f0; }
        .reroll-card-btn-confirm {
          background: #6366f1; color: #fff;
        }
        .reroll-card-btn-confirm:hover { background: #5558e3; }
      `;
      document.head.appendChild(styleEl);
    }

    const mask = document.createElement("div");
    mask.className = "reroll-card-mask";
    mask.innerHTML = `
      <div class="reroll-card-box">
        <div class="reroll-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          回溯重回
        </div>
        <div class="reroll-card-desc">
          此操作将擦除该消息之后的所有对话并重新获取 AI 回复。可在下方输入对此次重回的要求（可选），例如：温柔一点、不许再提这件事等。
        </div>
        <textarea class="reroll-card-textarea" id="reroll-requirement-input" placeholder="输入对此次重回的要求（可留空）..." autocomplete="off"></textarea>
        <div class="reroll-card-actions">
          <button class="reroll-card-btn reroll-card-btn-cancel" id="reroll-cancel">取消</button>
          <button class="reroll-card-btn reroll-card-btn-confirm" id="reroll-confirm">确认重回</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const textarea = mask.querySelector("#reroll-requirement-input");
    const close = (val) => { mask.remove(); resolve(val); };

    mask.querySelector("#reroll-cancel").onclick = () => close(null);
    mask.querySelector("#reroll-confirm").onclick = () => close(textarea.value.trim());
    mask.addEventListener("click", (e) => { if (e.target === mask) close(null); });

    // 自动聚焦
    setTimeout(() => { if (textarea) textarea.focus(); }, 100);
  });
}

// 绑定操作中心事件
function initContextMenuHandlers() {
  if (isContextMenuInitialized) return;
  isContextMenuInitialized = true;

  const menu = document.getElementById("bubble-context-menu");
  if (!menu) return;
  
  menu.onclick = (e) => {
    if (e.target === menu) {
      menu.style.display = "none";
    }
  };

  const btnCancel = document.getElementById("btn-menu-cancel");
  if (btnCancel) {
    btnCancel.onclick = () => {
      menu.style.display = "none";
    };
  }

  const btnEdit = document.getElementById("btn-menu-edit");
  if (btnEdit) {
    btnEdit.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.messages.get(selectedMsgId);
      if (!msg) return;
      openCustomEditModal(selectedMsgId, msg.content, false);
    };
  }

  const btnRepairFormat = document.getElementById("btn-menu-repair-format");
  if (btnRepairFormat) {
    btnRepairFormat.onclick = () => {
      menu.style.display = "none";
      if (selectedMsgId) {
        openFormatRepairModal(selectedMsgId, false);
      }
    };
  }

  const btnTranslate = document.getElementById("btn-menu-translate");
  if (btnTranslate) {
    btnTranslate.onclick = async () => {
      menu.style.display = "none";
      if (selectedMsgId) {
        await translateChatMessage(selectedMsgId, false);
      }
    };
  }

  const btnFav = document.getElementById("btn-menu-favorite");
  if (btnFav) {
    btnFav.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.messages.get(selectedMsgId);
      if (!msg) return;
      await db.messages.update(selectedMsgId, { isFavorite: 1 });
      showCustomAlert("收入收藏室", "该消息已成功收入收藏室。");
    };
  }

  const btnMulti = document.getElementById("btn-menu-multi");
  if (btnMulti) {
    btnMulti.onclick = () => {
      menu.style.display = "none";
      enterMultiSelectMode();
    };
  }

  const btnRecall = document.getElementById("btn-menu-recall");
  if (btnRecall) {
    btnRecall.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.messages.get(selectedMsgId);
      if (!msg) return;
      
      if (msg.senderType === 'user') {
        await db.messages.update(selectedMsgId, { isRecalled: 1 });
        window._refreshAfterToolbarAction();
      } else {
        showCustomAlert("撤回失败", "无法撤回，这不是您的发言！");
      }
    };
  }

  const btnDeleteSingle = document.getElementById("btn-menu-delete-single");
  if (btnDeleteSingle) {
    btnDeleteSingle.onclick = async () => {
      menu.style.display = "none";
      showCustomConfirm("确认删除", "确定要删除这条消息吗？此操作不可逆。", async () => {
        await db.messages.delete(selectedMsgId);
        window._refreshAfterToolbarAction();
      });
    };
  }

  const btnReroll = document.getElementById("btn-menu-reroll");
  if (btnReroll) {
    btnReroll.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.messages.get(selectedMsgId);
      if (!msg) return;

      let targetUserMsg = null;
      if (msg.senderType === 'user') {
        targetUserMsg = msg;
      } else {
        const rawList = await db.messages.where('sessionId').equals(activeSessionId).toArray();
        const history = rawList
          .filter(m => m.timestamp <= msg.timestamp)
          .sort((a, b) => a.timestamp - b.timestamp);

        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].senderType === 'user') {
            targetUserMsg = history[i];
            break;
          }
        }
      }

      if (!targetUserMsg) {
        showCustomAlert("无法回溯", "未能在上下文中搜寻到我的发言。");
        return;
      }

      // 弹出回溯重回要求输入卡片
      const requirement = await showRerollRequirementCard();
      if (requirement === null) return; // 用户取消

      const rawList = await db.messages.where('sessionId').equals(activeSessionId).toArray();
      const toDelete = rawList.filter(m => m.timestamp > targetUserMsg.timestamp);

      for (let td of toDelete) {
        await db.messages.delete(td.id);
      }

      await renderDialogMessages();

      // 将回溯要求暂存，供 AI 回复函数注入 prompt
      window._rerollRequirement = requirement || "";

      const btnReply = document.getElementById("btn-dialog-reply");
      if (btnReply) btnReply.click();
    };
  }

  const btnMultiCancel = document.getElementById("btn-multi-cancel");
  if (btnMultiCancel) {
    btnMultiCancel.onclick = () => {
      exitMultiSelectMode();
    };
  }

  const btnMultiTranslate = document.getElementById("btn-multi-translate");
  if (btnMultiTranslate) {
    btnMultiTranslate.onclick = () => batchTranslateMessages(false);
  }

  const btnMultiDelete = document.getElementById("btn-multi-delete");
  if (btnMultiDelete) {
    btnMultiDelete.onclick = async () => {
      const checked = document.querySelectorAll(".msg-checkbox:checked");
      if (checked.length === 0) return;
      showCustomConfirm("批量删除", `确认要彻底删除这 ${checked.length} 条选中的消息吗？`, async () => {
        for (let chk of checked) {
          const id = Number(chk.getAttribute("data-msg-id"));
          await db.messages.delete(id);
        }
        exitMultiSelectMode();
        renderDialogMessages();
      });
    };
  }
}

function enterMultiSelectMode() {
  isMultiSelectMode = true;
  document.getElementById("normal-input-row").style.display = "none";
  document.getElementById("multi-select-bar").style.display = "flex";
  document.getElementById("selected-count").innerText = "0";
  
  document.querySelectorAll(".msg-select-checkbox").forEach(el => el.style.display = "flex");
}

function exitMultiSelectMode() {
  isMultiSelectMode = false;
  document.getElementById("normal-input-row").style.display = "flex";
  document.getElementById("multi-select-bar").style.display = "none";
  
  document.querySelectorAll(".msg-select-checkbox").forEach(el => el.style.display = "none");
}

function updateSelectedCount() {
  const count = document.querySelectorAll(".msg-checkbox:checked").length;
  document.getElementById("selected-count").innerText = count;
}

// 通用自研世界书手风琴勾选渲染器 (单聊/群聊全独立隔离挂载)
async function renderWbMountedAccordion(containerEl, currentMountedIds, checkboxClass) {
  containerEl.innerHTML = "";
  const allEntries = await db.world_book_entries.toArray();
  if (allEntries.length === 0) {
    containerEl.innerHTML = `<div style="font-size:11px; color:var(--text-secondary); text-align:center; padding:12px;">世界书内暂无任何知识条目，请先前往世界书应用创建。</div>`;
    return;
  }

  const groups = {};
  allEntries.forEach(e => {
    const grp = e.group || "默认分组";
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(e);
  });

  for (let grpName in groups) {
    const groupEntries = groups[grpName];
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border:1px solid var(--border); border-radius:8px; background:#ffffff; margin-bottom:6px; overflow:hidden;";

    const mountedInGroupCount = groupEntries.filter(e => currentMountedIds.includes(e.id)).length;

    wrapper.innerHTML = `
      <div class="wb-mount-group-header" style="padding:8px 10px; font-size:12px; font-weight:700; color:var(--text-primary); background:#f8fafc; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none;">
        <span>${escapeHtml(grpName)} (${mountedInGroupCount}/${groupEntries.length})</span>
        <svg viewBox="0 0 24 24" width="14" height="14" style="transition:transform 0.2s;" class="arrow-icon"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
      </div>
      <div class="wb-mount-group-body" style="padding:6px; display:flex; flex-direction:column; gap:6px;"></div>
    `;

    const header = wrapper.querySelector(".wb-mount-group-header");
    const body = wrapper.querySelector(".wb-mount-group-body");
    const arrow = wrapper.querySelector(".arrow-icon");

    header.onclick = () => {
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "flex" : "none";
      arrow.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
    };

    groupEntries.forEach(entry => {
      const isChecked = currentMountedIds.includes(entry.id);
      const itemRow = document.createElement("label");
      itemRow.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px; border-radius:6px; background:#fafbfc; cursor:pointer; font-size:11.5px;";
      
      const mode = entry.mode || (entry.isActive ? 'constant' : 'disabled');
      let modeBadge = '<svg width="8" height="8" viewBox="0 0 24 24" style="vertical-align:middle; margin-right:2px;"><circle cx="12" cy="12" r="10" fill="#3b82f6"/></svg>永久';
      if (mode === 'selective') modeBadge = '<svg width="8" height="8" viewBox="0 0 24 24" style="vertical-align:middle; margin-right:2px;"><circle cx="12" cy="12" r="10" fill="#22c55e"/></svg>关键词';
      else if (mode === 'disabled') modeBadge = '<svg width="8" height="8" viewBox="0 0 24 24" style="vertical-align:middle; margin-right:2px;"><circle cx="12" cy="12" r="10" fill="#ef4444"/></svg>禁用';

      itemRow.innerHTML = `
        <input type="checkbox" class="${checkboxClass}" value="${entry.id}" ${isChecked ? 'checked' : ''} style="width:15px; height:15px; cursor:pointer;">
        <div style="flex:1; overflow:hidden; text-align:left;">
          <span style="font-weight:700; color:var(--text-primary);">${escapeHtml(entry.title)}</span>
          <span style="font-size:9.5px; color:var(--text-secondary); margin-left:4px;">(${modeBadge} | 深度:${entry.depth ?? 10})</span>
        </div>
      `;
      body.appendChild(itemRow);
    });

    // 默认如果该分组下包含已挂载条目，则保持展开；若无挂载则自动收起
    if (mountedInGroupCount === 0) {
      body.style.display = "none";
      arrow.style.transform = "rotate(-90deg)";
    }

    containerEl.appendChild(wrapper);
  }
}
window.renderWbMountedAccordion = renderWbMountedAccordion;

// 桥接函数：调用独立出去的 app_prompts.js 进行 Prompt 构建
async function buildSystemPrompt(sessionId) {
  let basePrompt = await buildGlobalSystemPrompt(sessionId);
  // 注入表情包系统上下文
  if (window.stickerSystem && window.stickerSystem.buildStickerSystemPrompt) {
    const stickerPrompt = await window.stickerSystem.buildStickerSystemPrompt(sessionId);
    if (stickerPrompt) {
      basePrompt += '\n\n' + stickerPrompt;
    }
  }
  return basePrompt;
}

// 顶级事件绑定注册 (安全保护锁)
function bindChatAppEvents() {
  if (isChatAppEventsBound) return;
  isChatAppEventsBound = true;

  // 绑定快捷封锁警告栏操作按钮
  const btnUnblockDirect = document.getElementById("btn-unblock-char-direct");
  if (btnUnblockDirect) {
    btnUnblockDirect.onclick = async () => {
      await db.sessions.update(activeSessionId, { isBlockedByUser: 0, blockByUserReason: "" });
      showToast("已解除拉黑");
      const updatedSess = await db.sessions.get(activeSessionId);
      updateChatInputLockState(updatedSess);
      
      const btnDetailsBlockChar = document.getElementById("btn-details-block-char");
      if (btnDetailsBlockChar) btnDetailsBlockChar.innerText = "拉黑对方";
    };
  }

  const btnForceReplyDirect = document.getElementById("btn-force-reply-direct");
  if (btnForceReplyDirect) {
    btnForceReplyDirect.onclick = () => {
      const btnReply = document.getElementById("btn-dialog-reply");
      if (btnReply) btnReply.click();
    };
  }

  // 专属设置页底端三大破坏性功能按钮事件绑定
  const btnDetailsClearRecords = document.getElementById("btn-details-clear-records");
  if (btnDetailsClearRecords) {
    btnDetailsClearRecords.onclick = () => {
      showCustomConfirm("清空记录", "确定要清空该对话下的所有内容吗？\n\n这将彻底抹除本单聊下的所有线上消息、线下对白、阶段总结、历史约会存档，操作不可恢复！", async () => {
        await db.messages.where('sessionId').equals(activeSessionId).delete();
        await db.offline_messages.where('sessionId').equals(activeSessionId).delete();
        await db.summaries.where('sessionId').equals(activeSessionId).delete();
        await db.sessions.update(activeSessionId, {
          coreSelfStatus: "",
          coreSelfPurpose: "",
          coreSelfChanges: "",
          coreRelationship: "",
          coreUserInEyes: "",
          isBlockedByUser: 0,
          blockByUserReason: "",
          isBlockedByChar: 0,
          blockByCharReason: ""
        });
        
        showToast("该会话下的所有物理关联数据已彻底抹除");
        closeChatDetails();
        renderDialogMessages();
        const updatedSess = await db.sessions.get(activeSessionId);
        updateChatInputLockState(updatedSess);
      });
    };
  }

  const btnDetailsDeleteSession = document.getElementById("btn-details-delete-session");
  if (btnDetailsDeleteSession) {
    btnDetailsDeleteSession.onclick = () => {
      showCustomConfirm("删除对话", "确定要彻底删除该对话及其中包含的所有对白消息与环境设定吗？此操作不可逆！", async () => {
        await db.messages.where('sessionId').equals(activeSessionId).delete();
        await db.offline_messages.where('sessionId').equals(activeSessionId).delete();
        await db.summaries.where('sessionId').equals(activeSessionId).delete();
        await db.sessions.delete(activeSessionId);
        
        showToast("对话已成功彻底注销并抹除");
        closeChatDetails();
        closeChatDialog();
      });
    };
  }

  const btnDetailsBlockChar = document.getElementById("btn-details-block-char");
  if (btnDetailsBlockChar) {
    btnDetailsBlockChar.onclick = async () => {
      const sess = await db.sessions.get(activeSessionId);
      if (sess.isBlockedByUser === 1) {
        await db.sessions.update(activeSessionId, { isBlockedByUser: 0, blockByUserReason: "" });
        btnDetailsBlockChar.innerText = "拉黑对方";
        showToast("已成功解除对对方的拉黑状态");
        const updatedSess = await db.sessions.get(activeSessionId);
        updateChatInputLockState(updatedSess);
      } else {
        showCustomPrompt("请输入拉黑对方的具体原因", "对方频繁无理取闹，暂时拉黑处理", async (reason) => {
          if (!reason) return;
          await db.sessions.update(activeSessionId, { isBlockedByUser: 1, blockByUserReason: reason });
          btnDetailsBlockChar.innerText = "解除拉黑";
          showToast("已成功将对方拉黑");
          const updatedSess = await db.sessions.get(activeSessionId);
          updateChatInputLockState(updatedSess);
        });
      }
    };
  }

  // 绑定自定义消息编辑框控制
  const btnCloseEditModal = document.getElementById("btn-close-edit-modal");
  const btnCancelEditModal = document.getElementById("btn-cancel-edit-modal");
  const btnSaveEditModal = document.getElementById("btn-save-edit-modal");
  
  if (btnCloseEditModal) btnCloseEditModal.onclick = closeCustomEditModal;
  if (btnCancelEditModal) btnCancelEditModal.onclick = closeCustomEditModal;
  if (btnSaveEditModal) {
    btnSaveEditModal.onclick = async () => {
      const textarea = document.getElementById("custom-edit-textarea");
      const newContent = textarea ? textarea.value.trim() : "";
      if (currentEditingMsgId) {
        if (isEditingOfflineMsg) {
          if (newContent !== "") {
            await db.offline_messages.update(currentEditingMsgId, { content: newContent });
            renderOfflineMessages();
          }
        } else {
          if (newContent !== "") {
            await db.messages.update(currentEditingMsgId, { content: newContent });
            window._refreshAfterToolbarAction();
          }
        }
      }
      closeCustomEditModal();
    };
  }

  const btnFocusTrigger = document.getElementById("btn-chat-focus");
  if (btnFocusTrigger) {
    // 彻底清空常规 onclick，防范单点事件冲突
    btnFocusTrigger.onclick = null;

    // 使用捕获模式（true）抢先拦截，斩断外部通用监听器冒泡
    btnFocusTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      console.log("专注中枢事件截获成功，正在唤起面板...");

      const expandPanel = document.getElementById("chat-expand-panel");
      if (expandPanel) expandPanel.classList.remove("active");

      const setupWin = document.getElementById("win-focus-setup");
      if (setupWin) {
        setupWin.classList.add("active");
        if (window.focusSpaceSystem && typeof window.focusSpaceSystem.loadSetupScreen === 'function') {
          window.focusSpaceSystem.loadSetupScreen();
        } else {
          console.warn("专注空间主系统尚未载入完毕，执行100ms延时自愈启动...");
          setTimeout(() => {
            if (window.focusSpaceSystem && typeof window.focusSpaceSystem.loadSetupScreen === 'function') {
              window.focusSpaceSystem.loadSetupScreen();
            }
          }, 100);
        }
      }
    }, true);
  }

  const btnNewChat = document.getElementById("btn-new-chat");
  if (btnNewChat) {
    btnNewChat.onclick = () => {
      if (!activeUserPersonaId) {
        showToast("请先在“我的”选项卡中选择我的人设！");
        return;
      }
      const choiceOverlay = document.getElementById("new-chat-choice-overlay");
      if (choiceOverlay) {
        choiceOverlay.classList.add("active");
      } else {
        // 降级兼容：若群聊面板未就绪则直接走单聊选择
        if (window.groupChatSystem && typeof window.groupChatSystem.openDirectChatSelector === 'function') {
          window.groupChatSystem.openDirectChatSelector();
        }
      }
    };
  }

  // 绑定“选择角色”弹层的右上角叉号关闭事件
  const btnCloseNewChat = document.getElementById("btn-close-new-chat");
  if (btnCloseNewChat) {
    btnCloseNewChat.onclick = () => {
      document.getElementById("new-chat-overlay").classList.remove("active");
    };
  }

  // 1. 发送消息
  const btnSend = document.getElementById("btn-dialog-send");
  const dialogInput = document.getElementById("dialog-input-text");
  
  if (btnSend && dialogInput) {
    // 仅阻止桌面端鼠标点击时输入框失去焦点
    btnSend.onmousedown = (e) => {
      e.preventDefault();
    };

    btnSend.onclick = async () => {
        let text = dialogInput.value.trim();
        if (!text) return;

        // 引用挂载检测
        if (window.quoteSystem && window.quoteSystem.getActiveQuote()) {
          text = `[QUOTE:${window.quoteSystem.getActiveQuote()}] ` + text;
          window.quoteSystem.clearQuote();
        }

        // 表情包过滤
        const processedText = window.stickerSystem ? await window.stickerSystem.processStickersInMessage(text, activeSessionId) : text;
        
        const sess = await db.sessions.get(activeSessionId);
        if (sess && sess.isGroup === 1) {
          // 首先判断是否被禁言
          const myMem = await db.group_members.where('[groupId+memberId+memberType]').equals([sess.groupId, Number(activeUserPersonaId), 'user']).first();
          
          // 核心分流：若 User（我）没有加入本群，直接进入旁白模式！发信内容作为中间灰字上屏
          if (!myMem) {
            const sysMsg = {
              sessionId: activeSessionId,
              senderType: 'system',
              senderId: 0,
              content: processedText,
              contentType: 'text',
              timestamp: Date.now()
            };
            await db.messages.add(sysMsg);
            await appendMessageToDOM(sysMsg);
            dialogInput.value = "";
            dialogInput.focus();
            return;
          }

          if (myMem.muteUntil && myMem.muteUntil > Date.now()) {
            const diffMin = Math.ceil((myMem.muteUntil - Date.now()) / 60000);
            showToast(`您已被群主或管理员禁言，还剩 ${diffMin} 分钟`);
            return;
          }

          await saveAndRenderMessage('user', processedText);
          dialogInput.value = "";
          dialogInput.focus();

          // 检测并触发机器人指令
          if (window.groupChatSystem && typeof window.groupChatSystem.interceptBotTrigger === 'function') {
            const u = await db.archives.get(Number(activeUserPersonaId));
            const senderName = u ? u.name : "User";
            const isIntercepted = await window.groupChatSystem.interceptBotTrigger(processedText, senderName);
            if (isIntercepted) return;
          }
        } else {
          await saveAndRenderMessage('user', processedText);
          dialogInput.value = "";
          dialogInput.focus(); // 显式回焦，保证键盘在移动端与桌面端均能顺畅保持不收起
        }
      };

    // 绑定回车发送事件
    dialogInput.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        const isEnterSendEnabled = localStorage.getItem("settings-enter-send") === "true";
        if (isEnterSendEnabled) {
          e.preventDefault(); // 阻止回车产生物理换行
          btnSend.click();
        }
      }
    };
  }

  // 2. 获取 AI 仿真回复 (微信交易及多媒体引擎重构)
  const btnReply = document.getElementById("btn-dialog-reply");
  if (btnReply) {
    btnReply.onclick = async () => {
      const header = document.getElementById("dialog-header-title");
      const originalTitle = header.innerText;

      // 如果当前正在请求，点击按钮立即中断
      if (onlineAbortController) {
        onlineAbortController.abort();
        onlineAbortController = null;
        header.classList.remove("header-typing");
        header.innerText = originalTitle;
        btnReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
        showToast("当前请求已终止");
        return;
      }

      const inputEl = document.getElementById("dialog-input-text");
      if (inputEl) inputEl.blur(); // 主动收回输入框焦距，强制收起软键盘 [1]

      // 会话隔离：锁定本次请求所属的 sessionId，后续所有操作（流式渲染、消息保存）都用它
      // 这样切换到其他会话时，请求仍在后台正常完成并保存到正确的会话，不会串台
      const reqSessionId = activeSessionId;

      header.classList.add("header-typing");
      // 切换成停止按钮 (浅红色圆角方块)
      btnReply.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="#f87171"/></svg>';

      try {
        onlineAbortController = new AbortController();
        onlineAbortController._reqSessionId = reqSessionId; // 标记本次请求所属会话
        const presetId = localStorage.getItem("global_api_preset_id");
        if (!presetId) throw new Error("未配置全局默认 API，请前往‘系统设置 - API 协议设置’中配置并应用！");
        const api = await db.api_presets.get(Number(presetId));
        if (!api) throw new Error("所选的 API 预设可能已被删除，请重新配置！");

        // === 【微信交易引擎核心逻辑】：AI自动拦截并收取/拆开玩家发送的交易，并生成对应的灰色系统卡片 ===
        const rawList = await db.messages.where('sessionId').equals(activeSessionId).toArray();
        const pendingUserTransactions = rawList.filter(m => m.senderType === 'user' && (m.contentType === 'transfer' || m.contentType === 'red_envelope'));
        
        // 直接复用函数头部已加载的 sessObj 变量，绝不重复定义以避免 SyntaxError 异常
        let autoReclaimContext = "";
        for (let ut of pendingUserTransactions) {
          try {
            const data = JSON.parse(ut.content);
            if (data.status === 'pending') {
              // 模拟AI自动收钱行为并更新数据库
              data.status = ut.contentType === 'transfer' ? 'received' : 'opened';
              await db.messages.update(ut.id, { content: JSON.stringify(data) });
              
              // 物理向数据库追加一条系统通知灰字，确保上屏与存盘对齐
              let noticeText = "";
              if (ut.contentType === 'transfer') {
                noticeText = sessObj.isGroup === 1 ? `[系统通知] ${originalTitle} 确认收钱，收取了 你的转账` : `[系统通知] 对方已确认收钱`;
              } else {
                noticeText = sessObj.isGroup === 1 ? `[系统通知] ${originalTitle} 领取了 你的红包` : `[系统通知] 对方领取了你的红包`;
              }

              const sysMsg = {
                sessionId: activeSessionId,
                senderType: 'system',
                senderId: 0,
                content: noticeText,
                contentType: 'text',
                timestamp: Date.now()
              };
              await db.messages.add(sysMsg);
              await appendMessageToDOM(sysMsg); // 瞬时灰字置中上屏
              
              // 自动合成记账文本提示词喂给大模型
              const transactionName = ut.contentType === 'transfer' ? '微信转账' : '微信红包';
              autoReclaimContext += `【系统通知：对方（${originalTitle}）已经确认领取并收下了你刚刚发送的${transactionName}，资金为 ￥ ${data.amount.toFixed(2)} 元${ut.contentType === 'red_envelope' ? `，红包备注为："${data.remark}"` : ''}】\n`;
            }
          } catch(e) { console.error(e); }
        }

        const history = await db.messages.where('sessionId').equals(activeSessionId).reverse().limit(10).toArray();
        history.reverse();
        
        const systemPrompt = await buildSystemPrompt(activeSessionId);

        // 检查"心声随动生产"开关状态
        const statusAutoToggle = document.getElementById("details-status-auto");
        const isStatusAutoOn = statusAutoToggle ? statusAutoToggle.checked : false;

        // 检查"翻译随动生成"开关状态
        const translateAutoToggleEl = document.getElementById("details-translate-auto");
        const isTranslateAutoOn = translateAutoToggleEl ? translateAutoToggleEl.checked : false;

        let finalSystemPrompt = systemPrompt;
        if (isStatusAutoOn) {
          const session = await db.sessions.get(activeSessionId);
          const charName = session ? (session.customCharName || session.name || "对方") : "对方";
          let myName = "我";
          if (session && session.userId) {
            const userArch = await db.archives.get(session.userId);
            if (userArch && userArch.name) myName = userArch.name;
          }

          finalSystemPrompt += `\n\n【心声随动指令（重要）】
你需要在回复正常对话内容之后，额外输出当前角色（${charName}）对 ${myName} 此时此刻的真实内心状态。
请严格按照以下格式输出：

正常对话内容...

[STATUS]
{ "attire": "当前穿着描述", "affection": "好感度描述(0-100)", "excitement": "兴奋度/紧绷感描述", "thoughts": "此刻真实倾诉想法", "hiddenCorners": "心底隐秘想法/反差心声" }`;
        }

        // 翻译随动生成：要求 AI 在回复末尾追加 [TRANSLATE] 标签包裹的中文翻译
        if (isTranslateAutoOn) {
          finalSystemPrompt += `\n\n【翻译随动指令（重要）】
你需要在回复正常对话内容之后（如有心声则在心声之后），额外输出本次回复内容的中文翻译。
如果回复本身已是中文，则翻译为英文；如果回复包含非中文（如日语、英语、法语等），则翻译为简体中文。
请严格按照以下格式输出：

正常对话内容...

[TRANSLATE]
本次回复的完整翻译内容`;
        }

        // 注入回溯重回要求（若存在），约束 char 本次重回的内容方向
        if (window._rerollRequirement) {
          finalSystemPrompt += `\n\n【回溯重回要求（本次回复必须严格遵守）】：${window._rerollRequirement}`;
          // 注入后立即清除，避免污染后续普通回复
          window._rerollRequirement = "";
        }

        const messagesToSend = [{ role: "system", content: finalSystemPrompt }];

        // 核心注入：在消息对话前注入领取提醒，实现极其逼生的互动对白！
        if (autoReclaimContext) {
          messagesToSend.push({
            role: "system", 
            content: `【微信收账通知（请立刻动态做出符合性格特色的反应）】：你在打开微信时，屏幕上弹出了你刚刚点击领取并成功入账用户钱款的通知：\n${autoReclaimContext}\n请你在本次回复中，配合符合你自身身份口吻 and 态度的台词，对此做出道谢、调侃、戏谑或客气回应，严厉禁止说教！`
          });
        }

        const sessObj = await db.sessions.get(activeSessionId);

        // 预解析当前会话的角色名与用户名，用于转发卡片在上下文中的明确摘要（标注谁转发给谁）
        let _chatCharName = "对方";
        let _chatMyName = "我";
        if (sessObj) {
          if (sessObj.customCharName) {
            _chatCharName = sessObj.customCharName;
          } else if (sessObj.charId) {
            const _charArch = await db.archives.get(sessObj.charId);
            if (_charArch && _charArch.name) _chatCharName = _charArch.name;
          }
          if (sessObj.userId) {
            const _userArch = await db.archives.get(sessObj.userId);
            if (_userArch && _userArch.name) _chatMyName = _userArch.name;
          }
        }

        // 异步映射历史记录，智能计算设定/真实时间流逝，插入带精准场景虚拟时间的系统标块
        const simNow = getSimulatedNow(sessObj);
        let prevTime = null;
        for (let h of history) {
          const simDate = getMessageDisplayDate(h, sessObj);
          // 智能计算时间间隔插入系统标块 (超过15分钟自动提示时间流逝并附带当时虚拟场景时刻)
          if (prevTime !== null && h.timestamp) {
            const diffMs = h.timestamp - prevTime;
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin >= 15) {
              let timeGapText = "";
              const formattedSimTime = formatWeChatTime(simDate, simNow);
              if (diffMin < 60) {
                timeGapText = `[系统提示：距离上一条对话过去了 ${diffMin} 分钟，当前场景时间：${formattedSimTime}]`;
              } else if (diffMin < 1440) {
                const diffHours = (diffMin / 60).toFixed(1);
                timeGapText = `[系统提示：距离上一条对话过去了 ${diffHours} 小时，当前场景时间：${formattedSimTime}]`;
              } else {
                const diffDays = Math.floor(diffMin / 1440);
                timeGapText = `[系统提示：距离上一条对话过去了 ${diffDays} 天，当前场景时间：${formattedSimTime}]`;
              }
              messagesToSend.push({ role: "system", content: timeGapText });
            }
          }
          prevTime = h.timestamp || prevTime;

          const prefix = `[MSG_ID: ${h.id}] `;
          let displayContent = h.content;

          // 从历史消息中物理剥离旧思维链（覆盖所有标签变体 + 未闭合兜底）
          if (typeof displayContent === 'string') {
            displayContent = displayContent.replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "").trim();
          }

          if (h.isRecalled === 1) {
            displayContent = "[已撤回该消息]";
          } else if (h.contentType === 'image') {
            try {
              const data = JSON.parse(h.content);
              displayContent = `[图片描述: ${data.text}]`;
            } catch(e) {}
          } else if (h.contentType === 'voice') {
            try {
              const data = JSON.parse(h.content);
              displayContent = `[语音转文字: ${data.text}]`;
            } catch(e) {}
          } else if (h.contentType === 'call') {
            // 通话记录卡片在上下文中转为简短可读摘要，避免裸 JSON 污染
            try {
              const c = JSON.parse(h.content);
              if (c.rejected) {
                displayContent = `[你拒绝了对方的${c.type === 'video' ? '视频' : '语音'}通话请求]`;
              } else {
                displayContent = `[${c.type === 'video' ? '视频' : '语音'}通话记录 · ${c.summary || ''}]`;
              }
            } catch(e) { displayContent = "[通话记录]"; }
          } else if (h.contentType === 'social_notice') {
            // 社交动作跳转卡片在上下文中转为简短摘要
            try {
              const sn = JSON.parse(h.content);
              if (sn.type === 'moment') {
                displayContent = `[你发了一条朋友圈：${sn.summary || ''}]`;
              } else if (sn.type === 'forum_post') {
                displayContent = `[你以 ${sn.roleLabel || ''} @${sn.username || ''} 身份在论坛发了帖子《${sn.title || ''}》]`;
              } else if (sn.type === 'forum_alt_create') {
                displayContent = `[你建立了一个论坛小号 @${sn.username || ''}（${sn.nickname || ''}）]`;
              } else {
                displayContent = `[社交动作记录]`;
              }
            } catch(e) { displayContent = "[社交动作记录]"; }
          } else if (h.contentType === 'moment_share') {
            // 朋友圈转发卡片在上下文中转为明确摘要，明确标注"谁转发给谁"
            try {
              const ms = JSON.parse(h.content);
              const originalAuthor = ms.authorName || '某人';
              const commentSuffix = ms.commentText ? `（附言：${ms.commentText}）` : '';
              if (h.senderType === 'user') {
                // 我转发给当前会话角色
                displayContent = `[${_chatMyName} 向 ${_chatCharName} 转发了 ${originalAuthor} 的朋友圈动态：${ms.summary || ''}${commentSuffix}]`;
              } else {
                // 当前会话角色转发给我
                const forwarderName = ms.forwarderName || _chatCharName;
                displayContent = `[${forwarderName} 向 ${_chatMyName} 转发了 ${originalAuthor} 的朋友圈动态：${ms.summary || ''}${commentSuffix}]`;
              }
            } catch(e) { displayContent = "[转发了一条朋友圈]"; }
          } else if (h.contentType === 'forum_post_share') {
            // 论坛帖子转发卡片在上下文中转为明确摘要，明确标注"谁转发给谁"
            try {
              const fps = JSON.parse(h.content);
              const originalAuthor = fps.authorName || '某成员';
              const commentSuffix = fps.commentText ? `（附言：${fps.commentText}）` : '';
              if (h.senderType === 'user') {
                displayContent = `[${_chatMyName} 向 ${_chatCharName} 转发了 ${originalAuthor} 的论坛帖子《${fps.title || ''}》：${fps.summary || ''}${commentSuffix}]`;
              } else {
                const forwarderName = fps.forwarderName || _chatCharName;
                displayContent = `[${forwarderName} 向 ${_chatMyName} 转发了 ${originalAuthor} 的论坛帖子《${fps.title || ''}》：${fps.summary || ''}${commentSuffix}]`;
              }
            } catch(e) { displayContent = "[转发了一条论坛帖子]"; }
          } else if (h.contentType === 'pay_for_me') {
            // 代付请求卡片在上下文中转为明确摘要，便于 AI 识别这是一个"需要它代付的订单"
            // 而不是普通转账/红包，从而使用 AGREE_PAY 指令而非发起转账。
            try {
              const pf = JSON.parse(h.content);
              const isPaid = pf.status === 'paid';
              const itemsStr = (pf.items || []).map(it =>
                `${it.name || it.title || '商品'} x${it.quantity || 1} ¥${(it.price || 0).toFixed(2)}`
              ).join('，');
              const totalStr = (pf.total || 0).toFixed(2);
              const msgSuffix = pf.message ? `，留言："${pf.message}"` : '';
              if (h.senderType === 'user') {
                // 我向对方发起代付请求
                if (isPaid) {
                  displayContent = `[${_chatCharName} 已为你代付了订单：${itemsStr}，合计 ¥${totalStr}${msgSuffix}]`;
                } else {
                  displayContent = `[你向 ${_chatCharName} 发送了一个代付请求订单：${itemsStr}，合计 ¥${totalStr}${msgSuffix}。该订单等待对方代付，对方应使用 [AGREE_PAY]{} 指令同意代付]`;
                }
              } else {
                // 对方（AI 角色）向我发起代付请求 —— 这是 AI 最需要识别的场景
                if (isPaid) {
                  displayContent = `[你已经为 ${_chatCharName} 代付了订单：${itemsStr}，合计 ¥${totalStr}${msgSuffix}]`;
                } else {
                  displayContent = `[${_chatCharName} 向你发送了一个代付请求订单：${itemsStr}，合计 ¥${totalStr}${msgSuffix}。这是一个需要你代为付款的订单，你若愿意帮忙，请在回复末尾追加 [AGREE_PAY]{} 指令表示同意代付；切勿用 [TRANSFER] 转账代替，代付与转账是两种不同动作]`;
                }
              }
            } catch(e) { displayContent = "[收到一个代付请求]"; }
          } else if (h.contentType === 'gift') {
            // 礼物卡片在上下文中转为明确摘要
            try {
              const gf = JSON.parse(h.content);
              const isReceived = gf.status === 'paid';
              const itemsStr = (gf.items || []).map(it =>
                `${it.name || it.title || '礼物'} x${it.quantity || 1} ¥${(it.price || 0).toFixed(2)}`
              ).join('，');
              const totalStr = (gf.total || 0).toFixed(2);
              const msgSuffix = gf.message ? `，附言："${gf.message}"` : '';
              if (h.senderType === 'user') {
                displayContent = `[你向 ${_chatCharName} 送了礼物：${itemsStr}，合计 ¥${totalStr}${msgSuffix}]`;
              } else {
                displayContent = `[${_chatCharName} 送了你礼物：${itemsStr}，合计 ¥${totalStr}${msgSuffix}${isReceived ? '，你已查收' : ''}]`;
              }
            } catch(e) { displayContent = "[收到一份礼物]"; }
          } else if (h.contentType === 'withdraw_share') {
            // 砍一刀提现分享链接：在上下文中转为明确摘要，让 AI 知道这是 user 在转发砍一刀活动
            try {
              const ws = JSON.parse(h.content);
              const targetStr = (ws.targetAmount || 700) + '元';
              const currentStr = (ws.currentAmount || 0).toFixed(2) + '元';
              if (h.senderType === 'user') {
                displayContent = `[你向 ${_chatCharName} 转发了一个"砍一刀提现"活动链接，你正在提现${targetStr}，目前已有${currentStr}，希望对方帮你点击助力。这是一条仿拼多多砍一刀的分享链接，不是真实的网页链接]`;
              } else {
                displayContent = `[${_chatCharName} 向你转发了一个"砍一刀提现"活动链接]`;
              }
            } catch(e) { displayContent = "[转发了一个砍一刀提现链接]"; }
          }

          // 核心 Few-shot 历史格式对齐
          if (sessObj && sessObj.isGroup === 1 && h.senderType === 'char') {
            const charSender = await db.archives.get(Number(h.senderId));
            const senderName = charSender ? charSender.name : "群成员";
            displayContent = `[SENDER: ${senderName}] ${displayContent}`;
          }

          if (displayContent) {
            messagesToSend.push({ role: h.senderType === 'user' ? 'user' : 'assistant', content: prefix + displayContent });
          }
        }

        // TODO (待以后优化解决): 群聊模式下由于多角色 (Multi-Char) 连续发言与流式/思维链容易卡死，
        // 暂时在群聊场景关闭流式传输与思维链预显，采用单次响应。
        const isGroupMode = sessObj && sessObj.isGroup === 1;
        const activeApi = isGroupMode ? { ...api, disableStream: true } : api;

        // 挂载流式渲染交互气泡 (单聊模式下正常预显)
        let streamingBubble = null;
        const handleStreamChunk = isGroupMode ? null : (delta, currentFullText) => {
          // 会话隔离：只有在用户仍在原请求会话时才渲染流式气泡
          if (activeSessionId !== reqSessionId) return;

          const container = document.getElementById("dialog-messages-container");
          if (!container) return;

          if (!streamingBubble) {
            streamingBubble = document.createElement("div");
            streamingBubble.className = "msg-bubble other streaming";
            streamingBubble.style.cssText = "position: relative; display: flex; align-items: flex-start;";
            container.appendChild(streamingBubble);
          }

          const parsedCot = parseThoughtFromText(currentFullText);
          let streamHtml = "";

          // 关键修复：流式渲染也必须遵守思维链开关。关闭时剥离 <think> 不显示思维链卡片，
          // 否则即使关闭开关，推理模型（如 DeepSeek-R1 / GLM）原生输出的 <think> 仍会实时显示在屏幕上
          const isCotStreamEnabled = sessObj && sessObj.cotToggle === 1;

          if (isCotStreamEnabled && parsedCot.thought) {
            streamHtml += `<div class="cot-thought-card" style="margin-bottom:6px; width:100%;"><div class="cot-thought-card-header"><div class="cot-thought-card-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg><span>深度思考中...</span></div></div><div class="cot-thought-card-body" style="display:block;">${escapeHtml(parsedCot.thought)}</div></div>`;
          }
          if (parsedCot.cleanText) {
            streamHtml += `<div class="msg-text" style="position: relative;">${escapeHtml(parsedCot.cleanText)}</div>`;
          } else if (!parsedCot.thought) {
            streamHtml += `<div class="msg-text" style="position: relative;">${escapeHtml(currentFullText)}</div>`;
          }

          streamingBubble.innerHTML = `<img class="msg-avatar" src="${resolveAvatar(activeSessionCharAvatar)}"><div style="flex:1; max-width: 80%;">${streamHtml}</div>`;
          container.scrollTop = container.scrollHeight;
        };

        let rawReply = await fetchStreamOrJson(activeApi.url, activeApi, messagesToSend, onlineAbortController.signal, handleStreamChunk);

        if (streamingBubble) {
          streamingBubble.remove();
          streamingBubble = null;
        }

        // 核心消除：自动擦除大模型在对白中误编或幻觉出来的 [MSG_ID: xxx] 标签
        rawReply = rawReply.replace(/[\[【]MSG_ID\s*:\s*\d+[\]】]/gi, "").trim();

        // 核心：前置整块提取 CoT 思维链 (仅在当前会话开启思维链且非群聊时才保留保存，关闭时直接擦除)
        let sessionCotHeader = "";
        const masterCot = parseThoughtFromText(rawReply);
        if (masterCot.thought) {
          const isCotEnabled = sessObj && sessObj.cotToggle === 1 && !isGroupMode;
          if (isCotEnabled) {
            sessionCotHeader = `<think>\n${masterCot.thought}\n</think>\n`;
          }
          rawReply = masterCot.cleanText; // 清洗后，rawReply 只保留对白与指令，绝对不会包含被切断的 <think>
        }

        // 核心自愈：检验首部是否包含 [QUOTE:消息ID]，若有，强制将引用原句清除并与后续真实回复并入单行，杜绝被回车切分为多条空卡片消息 [1.1]
        const firstQuoteMatch = rawReply.match(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]/i);
        if (firstQuoteMatch) {
          const quoteTag = firstQuoteMatch[0];
          const quoteId = Number(firstQuoteMatch[2]);
          const quotedMsg = await db.messages.get(quoteId);
          if (quotedMsg) {
            const origText = quotedMsg.content;
            const origBareText = typeof origText === 'string' ? origText.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '').trim() : "";
            
            let remaining = rawReply.replace(firstQuoteMatch[0], "").trim();
            if (origBareText) {
              // 精准捕捉并抹除可能紧随其后（包括换行符之后）的被引用原文，如：\n"原话"\n
              const quotesRegex = /^[\s\n\r]*["'“‘『「\(（【\[]*(.*?)[”’』」\)）】\]]*[\s\n\r]*/;
              let tempMatch = remaining.match(quotesRegex);
              if (tempMatch) {
                const innerText = tempMatch[1].trim();
                if (innerText.toLowerCase() === origBareText.toLowerCase() || origBareText.toLowerCase().includes(innerText.toLowerCase())) {
                  remaining = remaining.replace(tempMatch[0], "").trim();
                }
              }
            }
            // 重新拼接为单行气泡内容，打破 split 的换行切割条件，保障完美融合
            rawReply = `${quoteTag} ${remaining}`;
          }
        }

        // === 【群聊 AI 多人分流与指令决策器】 ===
            const currentSess = await db.sessions.get(reqSessionId);
            if (currentSess && currentSess.isGroup === 1) {
              // 打印大模型吐出的原始未加工对白，用以排查格式异形
              console.log("[Group Chat Debug] 1. 大模型返回的原始对白文本 rawReply:\n", rawReply);

              // 升级为高宽容双轨非消耗性正向断言正则，确保群聊对白零遗漏捕获
              const senderRegex = /[\[【]SENDER:\s*([^\]】\n]+)[\]】]\s*([\s\S]+?)(?=[\[【]SENDER:|$)/gi;
              let match;
              let hasGroupReplies = false;

              while ((match = senderRegex.exec(rawReply)) !== null) {
                hasGroupReplies = true;
                // 清洗可能伴随出现的冒号或空格，确保拿到纯净的档案馆角色名字
                const senderName = match[1].replace(/[:：]/g, "").trim();
                let textContent = match[2].trim();
                
                // 打印正则捕获的每次分流细节
                console.log(`[Group Chat Debug] 2. 正则分流捕获成功 -> 发信人: "${senderName}"，发言正文: "${textContent}"`);
                
                if (!textContent) continue;

            // 检查并执行 AI 物理管理动作指令 (禁言、踢人、头衔等)
            const actionMuteRegex = /[\[【]MUTE\s*[:：]\s*([^\s(（]+)\s*\((\d+)\)[\]】]/i;
            const muteMatch = textContent.match(actionMuteRegex);
            if (muteMatch && window.groupChatSystem) {
              const targetName = muteMatch[1].trim();
              const duration = parseInt(muteMatch[2]);
              await window.groupChatSystem.executeAiMuteCommand(senderName, targetName, duration);
              textContent = textContent.replace(actionMuteRegex, "").trim();
            }

            const actionKickRegex = /[\[【]KICK\s*[:：]\s*([^\]】]+)[\]】]/i;
            const kickMatch = textContent.match(actionKickRegex);
            if (kickMatch && window.groupChatSystem) {
              const targetName = kickMatch[1].trim();
              await window.groupChatSystem.executeAiKickCommand(senderName, targetName);
              textContent = textContent.replace(actionKickRegex, "").trim();
            }

            const actionTitleRegex = /[\[【]TITLE\s*[:：]\s*([^\s(（]+)\s*\(([^)]+)\)[\]】]/i;
            const titleMatch = textContent.match(actionTitleRegex);
            if (titleMatch && window.groupChatSystem) {
              const targetName = titleMatch[1].trim();
              const newTitle = titleMatch[2].trim();
              await window.groupChatSystem.executeAiTitleCommand(senderName, targetName, newTitle);
              textContent = textContent.replace(actionTitleRegex, "").trim();
            }

            const actionAdminRegex = /[\[【]ADMIN\s*[:：]\s*([^\s(（]+)\s*\((设为|取消)\)[\]】]/i;
            const adminMatch = textContent.match(actionAdminRegex);
            if (adminMatch && window.groupChatSystem) {
              const targetName = adminMatch[1].trim();
              const actType = adminMatch[2].trim();
              await window.groupChatSystem.executeAiAdminCommand(senderName, targetName, actType);
              textContent = textContent.replace(actionAdminRegex, "").trim();
            }

            const actionTransferRegex = /[\[【]TRANSFER_OWNER\s*[:：]\s*([^\]】]+)[\]】]/i;
            const txMatch = textContent.match(actionTransferRegex);
            if (txMatch && window.groupChatSystem) {
              const targetName = txMatch[1].trim();
              await window.groupChatSystem.executeAiTransferOwnerCommand(senderName, targetName);
              textContent = textContent.replace(actionTransferRegex, "").trim();
            }

            // 检查并执行 AI 发起群投票指令 [POLL: 主题 (选项1 | 选项2)]
            const actionPollRegex = /[\[【]POLL\s*[:：]\s*([^\s(（]+)\s*\(([^)]+)\)[\]】]/i;
            const pollMatch = textContent.match(actionPollRegex);
            if (pollMatch && window.groupChatSystem) {
              const pollTitle = pollMatch[1].trim();
              const optionsStr = pollMatch[2].trim();
              await window.groupChatSystem.executeAiPollCommand(senderName, pollTitle, optionsStr);
              textContent = textContent.replace(actionPollRegex, "").trim();
            }

            // 检查并执行 AI 发布群公告指令 [ANNOUNCE: 标题 (内容)] (升级为高宽容换行匹配正则)
            const actionAnnounceRegex = /[\[【]ANNOUNCE\s*[:：]\s*([^((（]+?)\s*[(（]([\s\S]+?)[)）][\]】]/i;
            const announceMatch = textContent.match(actionAnnounceRegex);
            if (announceMatch && window.groupChatSystem) {
              const annTitle = announceMatch[1].trim();
              const annText = announceMatch[2].trim();
              await window.groupChatSystem.executeAiAnnounceCommand(senderName, annTitle, annText);
              textContent = textContent.replace(actionAnnounceRegex, "").trim();
            }

            // 检查并执行 AI 发起定向转账指令 [TRANSFER: 收款人 (金额)]
            const actionTransferValRegex = /[\[【]TRANSFER\s*[:：]\s*([^\s(（]+)\s*\((\d+(?:\.\d+)?)\)[\]】]/i;
            const transferValMatch = textContent.match(actionTransferValRegex);
            if (transferValMatch && window.groupChatSystem) {
              const targetName = transferValMatch[1].trim();
              const amount = parseFloat(transferValMatch[2]) || 0;
              await window.groupChatSystem.executeAiTransferCommand(senderName, targetName, amount);
              textContent = textContent.replace(actionTransferValRegex, "").trim();
            }

            // 检查并执行 AI 发送普通/拼手气红包指令 (普通或拼手气) [RED_ENVELOPE: normal/lucky (金额) (备注)]
            const actionRedEnvelopeValRegex = /[\[【]RED_ENVELOPE\s*[:：]\s*(normal|lucky)\s*\((\d+(?:\.\d+)?)\)\s*(?:\(([^)]+)\))?[\]】]/i;
            const redEnvelopeValMatch = textContent.match(actionRedEnvelopeValRegex);
            if (redEnvelopeValMatch && window.groupChatSystem) {
              const envType = redEnvelopeValMatch[1].toLowerCase();
              const amount = parseFloat(redEnvelopeValMatch[2]) || 0;
              const remark = redEnvelopeValMatch[3] ? redEnvelopeValMatch[3].trim() : "恭喜发财，大吉大利";
              await window.groupChatSystem.executeAiRedEnvelopeCommand(senderName, envType, amount, remark);
              textContent = textContent.replace(actionRedEnvelopeValRegex, "").trim();
            }

            // 检查并执行 AI 拆开红包指令 [OPEN_RED_ENVELOPE: 消息ID]
            const actionOpenRedEnvelopeRegex = /[\[【](?:OPEN_RED_ENVELOPE|拆红包)\s*[:：]\s*(\d+)[\]】]/i;
            const openRedEnvelopeMatch = textContent.match(actionOpenRedEnvelopeRegex);
            if (openRedEnvelopeMatch && window.groupChatSystem) {
              const targetMsgId = Number(openRedEnvelopeMatch[1]);
              await window.groupChatSystem.executeAiClaimRedEnvelopeCommand(senderName, targetMsgId);
              textContent = textContent.replace(actionOpenRedEnvelopeRegex, "").trim();
            }

            // 检查并执行 AI 收取定向转账指令 [RECEIVE_TRANSFER: 消息ID]
            const actionReceiveTransferRegex = /[\[【](?:RECEIVE_TRANSFER|收钱|收转账)\s*[:：]\s*(\d+)[\]】]/i;
            const receiveTransferMatch = textContent.match(actionReceiveTransferRegex);
            if (receiveTransferMatch && window.groupChatSystem) {
              const targetMsgId = Number(receiveTransferMatch[1]);
              await window.groupChatSystem.executeAiClaimTransferCommand(senderName, targetMsgId);
              textContent = textContent.replace(actionReceiveTransferRegex, "").trim();
            }

            // 检查并执行 AI 已阅公告指令 [READ_ANNOUNCE: 消息ID] [2]
            const actionReadAnnounceRegex = /[\[【](?:READ_ANNOUNCE|已阅公告|阅读公告)\s*[:：]\s*(\d+)[\]】]/i;
            const readAnnounceMatch = textContent.match(actionReadAnnounceRegex);
            if (readAnnounceMatch && window.groupChatSystem) {
              const targetMsgId = Number(readAnnounceMatch[1]);
              await window.groupChatSystem.executeAiReadAnnounceCommand(senderName, targetMsgId);
              textContent = textContent.replace(actionReadAnnounceRegex, "").trim();
            }

            // 检查并执行 AI 参与投票指令 [VOTE_POLL: 消息ID (选项索引)] [2]
            const actionVotePollRegex = /[\[【](?:VOTE_POLL|参与投票|投票)\s*[:：]\s*(\d+)\s*\((\d+)\)[\]】]/i;
            const votePollMatch = textContent.match(actionVotePollRegex);
            if (votePollMatch && window.groupChatSystem) {
              const targetMsgId = Number(votePollMatch[1]);
              const optIdx = parseInt(votePollMatch[2]);
              await window.groupChatSystem.executeAiVotePollCommand(senderName, targetMsgId, optIdx);
              textContent = textContent.replace(actionVotePollRegex, "").trim();
            }

            if (textContent) {
              await window.groupChatSystem.saveGroupAiMessage(senderName, textContent);
            }
          }

          if (hasGroupReplies) {
            header.classList.remove("header-typing");
            header.innerText = originalTitle;
            btnReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
            onlineAbortController = null;
            return; // 直接退出，阻止原有单聊上屏逻辑
          }
        }

        // === 智能高精拉黑与解除拉黑指令高自愈性解析器（全/半角英文或中文括号均可） ===
        const charBlockRegex = /(\[|【)(BLOCK|拉黑)\s*[:：]\s*([^\]】\n]+)(\]|】)/i;
        const charUnblockRegex = /(\[|【)(UNBLOCK|解除拉黑)(\]|】)/i;

        const blockMatch = rawReply.match(charBlockRegex);
        if (blockMatch) {
          const reason = blockMatch[3].trim();
          await db.sessions.update(activeSessionId, {
            isBlockedByChar: 1,
            blockByCharReason: reason
          });
          rawReply = rawReply.replace(charBlockRegex, "").trim();
          showToast(`对方（${originalTitle}）拉黑了你。原因：${reason}`);
        }

        const unblockMatch = rawReply.match(charUnblockRegex);
        if (unblockMatch) {
          await db.sessions.update(activeSessionId, {
            isBlockedByChar: 0,
            blockByCharReason: ""
          });
          rawReply = rawReply.replace(charUnblockRegex, "").trim();
          showToast(`对方（${originalTitle}）已解除对你的拉黑`);
        }

        // === Char (AI) 撤回消息处理 ===
        const recallRegex = /[\[【](RECALL|撤回|撤回消息)(?:\s*:\s*(\d+))?[\]】]/i;
        const recallMatch = rawReply.match(recallRegex);
        if (recallMatch) {
          const targetId = recallMatch[2] ? Number(recallMatch[2]) : null;
          let targetMsg = null;
          if (targetId) {
            targetMsg = await db.messages.get(targetId);
          } else {
            const charMsgs = await db.messages.where('sessionId').equals(activeSessionId).and(m => m.senderType === 'char').toArray();
            targetMsg = charMsgs.sort((a,b) => b.timestamp - a.timestamp)[0];
          }

          if (targetMsg && targetMsg.senderType === 'char' && targetMsg.sessionId === activeSessionId) {
            await db.messages.update(targetMsg.id, { isRecalled: 1 });
            rawReply = rawReply.replace(recallRegex, "").trim();
            await renderDialogMessages();
          } else {
            rawReply = rawReply.replace(recallRegex, "").trim();
            alert(`系统提示：对方（${originalTitle}）试图撤回一则消息（ID: ${targetId || '最新'}），但由于消息ID无效，撤回失败！`);
          }
        }

        // === Char (AI) 自动驱使本地音乐播放指令解析 ===
        const playMusicRegex = /[\[【](PLAY_MUSIC|播放音乐|MCP_PLAY_MUSIC)[\]】]\s*(\{[\s\S]*?\})/i;
        const playMusicMatch = rawReply.match(playMusicRegex);
        if (playMusicMatch) {
          try {
            const parsed = JSON.parse(playMusicMatch[2]);
            const targetIndex = parseInt(parsed.index);
            if (!isNaN(targetIndex) && window.mcpSystem && typeof window.mcpSystem.playTrackByIndex === 'function') {
              window.mcpSystem.playTrackByIndex(targetIndex);
            } else if (parsed.title && window.mcpSystem && typeof window.mcpSystem.playTrackByTitle === 'function') {
              window.mcpSystem.playTrackByTitle(parsed.title);
            }
          } catch(e) {
            console.warn("解析 AI 自动放歌指令 JSON 失败:", e);
          }
          // 擦除放歌指令，避免污染对话气泡呈现
          rawReply = rawReply.replace(playMusicRegex, "").trim();
        }

        // === Char (AI) 自主设闹钟指令解析（容错：JSON 解析失败也能提取 delay 设闹钟）===
        const setAlarmRegex = /[\[【](SET_ALARM|设闹钟|设定闹钟|MCP_SET_ALARM)[\]】]\s*(\{[\s\S]*?\})/i;
        const setAlarmMatch = rawReply.match(setAlarmRegex);
        if (setAlarmMatch) {
          if (window.mcpSystem && typeof window.mcpSystem.setAlarmFromRawJson === 'function') {
            window.mcpSystem.setAlarmFromRawJson(setAlarmMatch[2]);
          }
          // 擦除设闹钟指令，避免污染对话气泡
          rawReply = rawReply.replace(setAlarmRegex, "").trim();
        }

        // === Char (AI) 表情反应处理 ===
        const reactRegex = /[\[【]REACT\s*:\s*(\d+)[\]】]\s*([\s\S]*?)(?=(?:\[|【|$))/i;
        const reactMatch = rawReply.match(reactRegex);
        if (reactMatch) {
          const targetId = Number(reactMatch[1]);
          const emoji = reactMatch[2].trim();
          const validEmojis = ["😂", "😚", "😌", "😊", "👿", "😪", "😭", "😣", "🙄", "🥺", "🥵", "🥰", "😉", "😏"];

          if (validEmojis.includes(emoji)) {
            const targetMsg = await db.messages.get(targetId);
            if (targetMsg && targetMsg.sessionId === activeSessionId) {
              const msgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
              const last20 = msgs.slice(-20);
              const isWithinLastRounds = last20.some(m => m.id === targetId);
              if (isWithinLastRounds) {
                await db.messages.update(targetId, { reactionEmoji: emoji });
                rawReply = rawReply.replace(reactRegex, "").trim();
                await renderDialogMessages();
              } else {
                rawReply = rawReply.replace(reactRegex, "").trim();
              }
            } else {
              rawReply = rawReply.replace(reactRegex, "").trim();
            }
          } else {
            rawReply = rawReply.replace(reactRegex, "").trim();
          }
        }

        // === 【社交动作指令预处理】在 MCP 循环之前提取并执行 [AUTO_MOMENT] / [FORUM_POST] 等 ===
        // 避免 AI 同时输出 [CALL_TOOL] 和 [FORUM_POST] 时，MCP 循环先把 FORUM_POST 当作普通文本消耗掉
        let pendingSocialNotices = [];
        if (window.socialActions && typeof window.socialActions.detectAndExecute === 'function') {
          try {
            const saResult = await window.socialActions.detectAndExecute(rawReply, activeSessionId);
            rawReply = saResult.cleanedText;
            pendingSocialNotices = saResult.sysNotices || [];
          } catch (e) { /* 静默 */ }
        }

        // === 【MCP 连贯 Agent 循环与折叠卡片渲染引擎（支持嵌套 JSON 与裸 JSON 智能自愈）】 ===
        const isAgentLoopEnabled = localStorage.getItem("settings-mcp-agent-loop-enabled") !== "false";
        let maxAgentLoops = 5; // 安全深度限制

        while (maxAgentLoops > 0) {
          const toolCallInfo = parseToolCallFromReply(rawReply);
          if (!toolCallInfo || !window.mcpClientSystem) {
            break;
          }

          try {
            const fullMatchStr = toolCallInfo.fullMatchStr;
            const toolIndex = toolCallInfo.index;

            // 提取工具调用之前的“前半句台词”
            let prefixText = rawReply.substring(0, toolIndex).trim();

            // 若思维链尚待绑定，将完整的 <think> 标签重新附着在第一句前置台词头部
            if (sessionCotHeader) {
              prefixText = sessionCotHeader + (prefixText ? ("\n" + prefixText) : "");
              sessionCotHeader = ""; // 标记为已消耗，防止后续重复绑卡
            }

            if (prefixText) {
              await saveAndRenderMessage('char', prefixText, 'text', reqSessionId);
            }

            const toolCallPayload = toolCallInfo.payload;
            const serverName = toolCallPayload.server;
            const toolName = toolCallPayload.tool;
            const toolArgs = toolCallPayload.arguments || {};

            rawReply = rawReply.substring(toolIndex + fullMatchStr.length).trim();

            showToast(`正在调用 MCP 工具: [${serverName}] -> ${toolName}...`);

            let executionResult = null;
            let isSuccess = true;
            try {
              executionResult = await window.mcpClientSystem.callMcpTool(serverName, toolName, toolArgs);
            } catch (execErr) {
              isSuccess = false;
              executionResult = { error: execErr.message };
            }

            const toolCardData = {
              server: serverName,
              tool: toolName,
              arguments: toolArgs,
              result: executionResult,
              status: isSuccess ? 'success' : 'error'
            };
            const toolMsg = {
              sessionId: activeSessionId,
              senderType: 'char',
              senderId: 0,
              content: JSON.stringify(toolCardData),
              contentType: 'mcp_tool',
              timestamp: Date.now()
            };
            toolMsg.id = await db.messages.add(toolMsg);
            await appendMessageToDOM(toolMsg);

            const assistantRecord = prefixText ? `${prefixText}\n[CALL_TOOL: ${JSON.stringify(toolCallPayload)}]` : `[CALL_TOOL: ${JSON.stringify(toolCallPayload)}]`;
            messagesToSend.push({ role: "assistant", content: assistantRecord });
            messagesToSend.push({
              role: "system",
              content: `【MCP 工具执行反馈通知】\n工具 [${serverName}.${toolName}] 返回了以下执行结果：\n${JSON.stringify(executionResult)}\n\n请结合上述工具执行结果，继续顺着你刚才的话（如有）以自然角色的口吻接下去说。如果你认为还需要调用其他工具，可以继续嵌入 [CALL_TOOL: ...] 指令。`
            });

            if (!isAgentLoopEnabled) break;
            maxAgentLoops--;

            rawReply = await fetchStreamOrJson(api.url, api, messagesToSend, onlineAbortController.signal, handleStreamChunk);

            if (streamingBubble) {
              streamingBubble.remove();
              streamingBubble = null;
            }

            rawReply = rawReply.replace(/[\[【]MSG_ID\s*:\s*\d+[\]】]/gi, "").trim();
            if (!rawReply) break;

          } catch (e) {
            console.error("MCP 工具 Agent 循环异常:", e);
            showToast("MCP 工具执行终止: " + e.message);
            break;
          }
        }

        // 尝试解析心声随动 [STATUS] 格式（用括号平衡法提取完整 JSON）
        let statusJson = null;
        let textReply = rawReply;
        if (isStatusAutoOn) {
          const statusIdx = rawReply.indexOf('[STATUS]');
          if (statusIdx !== -1) {
            const afterStatus = rawReply.substring(statusIdx + 8);
            const balancedJson = extractBalancedJson(afterStatus);
            if (balancedJson) {
              try {
                statusJson = JSON.parse(balancedJson);
                textReply = rawReply.substring(0, statusIdx).trim();
                // 保存心声到 status_history（线上：isTheater=0）
                try {
                  const userRegex = /\buser\b/gi;
                  const cleanProp = (val) => (typeof val === 'string') ? val.replace(userRegex, (sessObj?.customUserName || '我')) : val;
                  await db.status_history.add({
                    sessionId: activeSessionId,
                    theaterId: 0,
                    isTheater: 0,
                    timestamp: Date.now(),
                    attire: cleanProp(statusJson.attire) || '未详',
                    affection: cleanProp(statusJson.affection) || '未详',
                    excitement: cleanProp(statusJson.excitement) || '未详',
                    thoughts: cleanProp(statusJson.thoughts) || '未详',
                    hiddenCorners: cleanProp(statusJson.hiddenCorners) || '无'
                  });
                } catch (saveErr) { console.warn('保存心声历史失败:', saveErr); }
              } catch (e) {
                console.warn("解析心声 JSON 失败:", e);
              }
            }
          }
        }

        // 尝试解析翻译随动 [TRANSLATE] 格式
        let translationText = null;
        if (isTranslateAutoOn) {
          const translateMatch = textReply.match(/\[TRANSLATE\]\s*([\s\S]*?)(?=\[STATUS\]|$)/);
          if (translateMatch) {
            translationText = translateMatch[1].trim();
            textReply = textReply.replace(/\[TRANSLATE\]\s*[\s\S]*?(?=\[STATUS\]|$)/, '').trim();
          }
        }

        // === 【全模态多语境时序渲染中枢 3.0】：绑定未消耗的 CoT + 顺序分发文本与多媒体指令 ===
        if (sessionCotHeader) {
          textReply = sessionCotHeader + (textReply ? ("\n" + textReply) : "");
          sessionCotHeader = "";
        }

        const parsedCotMaster = parseThoughtFromText(textReply);
        let preservedThoughtHeader = "";
        let cleanReplyText = textReply;
        if (parsedCotMaster.thought) {
          preservedThoughtHeader = `<think>\n${parsedCotMaster.thought}\n</think>\n`;
          cleanReplyText = parsedCotMaster.cleanText;
        }

        // 0. 图片标签格式归一化预处理
        // 兼容 AI 输出的非标准格式：[图片描述: xxx] / [图片描述：xxx] / [图片: xxx] / [图片：xxx] / 【图片描述: xxx】
        // 统一归一化为标准 [IMAGE] xxx 格式，确保后续 transactionRegex 能正确识别
        cleanReplyText = cleanReplyText
          .replace(/([\[【])\s*图片描述\s*[:：]\s*([\s\S]*?)([\]】])/gi, function(m, b1, content, b2) {
            return '[IMAGE] ' + String(content).trim();
          })
          .replace(/([\[【])\s*图片\s*[:：]\s*([\s\S]*?)([\]】])/gi, function(m, b1, content, b2) {
            return '[IMAGE] ' + String(content).trim();
          });

        // 1. 顺序解析出文本与多媒体卡片序列 (保持 AI 吐字的原生前后顺序，杜绝多媒体卡片置顶置乱)
        // 关键修复：lookahead 只在下一个已知指令 token（[TOKEN] / 【TOKEN】）处切片，避免把 JSON 数组里的 [ 误判为新 token 起点导致 JSON 被腰斩
        const tokenKeywords = "TRANSFER|RED_ENVELOPE|RECEIVE_TRANSFER|OPEN_RED_ENVELOPE|VOICE|IMAGE|LOCATION|PAY_FOR_ME|GIFT|AGREE_PAY|转账|红包|收钱|收转账|拆红包|领红包|语音|图片|位置|代付|送礼|同意代付";
        const transactionRegex = new RegExp("([\\[【])(" + tokenKeywords + ")([\\]】])\\s*([\\s\\S]*?)(?=(?:[\\[【])(?:" + tokenKeywords + ")[\\]】]|$)", "gi");
        
        let responseItems = [];
        let lastIndex = 0;
        let tMatch;

        // 辅助智能分发切片器：基于 Session 配置的【最少句数】与【最多气泡数】实施受控拟真分句
        const minSentences = sessObj?.minSentenceCount || 1;
        const maxSentences = sessObj?.maxSentenceCount || 3;

        const splitTextIntoBubbles = (text, minCount = minSentences, maxCount = maxSentences) => {
          if (!text || typeof text !== 'string') return [];
          
          let initialParts = text.split(/\[SPLIT\]|【SPLIT】|[\n\r]+/i).map(p => p.trim()).filter(Boolean);
          let rawBubbles = [];

          initialParts.forEach(part => {
            const quoteMatch = part.match(/^[\[【](QUOTE|引用)\s*:\s*\d+[\]】]\s*/i);
            let quotePrefix = "";
            let barePart = part;

            if (quoteMatch) {
              quotePrefix = quoteMatch[0];
              barePart = part.substring(quoteMatch[0].length).trim();
            }

            // 按句末标点 (。！？!?) 拆分句项列表
            const sentenceRegex = /([^。！？!?]+[。！？!?]+)/g;
            let subSentences = barePart.match(sentenceRegex);

            if (subSentences && subSentences.length > 0) {
              let reassembledLen = 0;
              let currentChunk = [];

              subSentences.forEach((s, sIdx) => {
                currentChunk.push(s.trim());
                reassembledLen += s.length;

                // 只有合并句数达到最少句数 minCount，或是最后一个标点句时，才打包为一个独立的组合气泡
                if (currentChunk.length >= minCount || sIdx === subSentences.length - 1) {
                  let chunkText = currentChunk.join("");
                  currentChunk = [];

                  if (rawBubbles.length === 0 && quotePrefix) {
                    chunkText = quotePrefix + chunkText;
                    quotePrefix = "";
                  }

                  if (chunkText) rawBubbles.push(chunkText);
                }
              });

              // 补全末尾未带句末标点的残余尾巴
              const leftover = barePart.substring(reassembledLen).trim();
              if (leftover) {
                if (rawBubbles.length > 0) {
                  rawBubbles[rawBubbles.length - 1] += leftover;
                } else {
                  rawBubbles.push(leftover);
                }
              }
            } else {
              let singleText = part;
              if (rawBubbles.length === 0 && quotePrefix) {
                singleText = quotePrefix + singleText;
              }
              rawBubbles.push(singleText);
            }
          });

          // 核心上限管控：如果拆出的气泡数超过上限 maxCount，把溢出的气泡全部合拢合并到最后一个气泡中
          if (rawBubbles.length > maxCount) {
            const allowedBubbles = rawBubbles.slice(0, maxCount - 1);
            const overflowText = rawBubbles.slice(maxCount - 1).join("");
            allowedBubbles.push(overflowText);
            return allowedBubbles.filter(Boolean);
          }

          return rawBubbles.filter(Boolean);
        };

        while ((tMatch = transactionRegex.exec(cleanReplyText)) !== null) {
          const matchIndex = tMatch.index;
          if (matchIndex > lastIndex) {
            const textSegment = cleanReplyText.substring(lastIndex, matchIndex).trim();
            if (textSegment) {
              let splitParts = splitTextIntoBubbles(textSegment);
              splitParts.forEach(p => responseItems.push({ kind: 'text', content: p }));
            }
          }

          responseItems.push({
            kind: 'special',
            tokenRaw: tMatch[2].toUpperCase(),
            contentRaw: tMatch[4].trim(),
            fullMatch: tMatch[0]
          });

          lastIndex = transactionRegex.lastIndex;
        }

        if (lastIndex < cleanReplyText.length) {
          const remainingText = cleanReplyText.substring(lastIndex).trim();
          if (remainingText) {
            let splitParts = splitTextIntoBubbles(remainingText);
            splitParts.forEach(p => responseItems.push({ kind: 'text', content: p }));
          }
        }

        if (responseItems.length === 0 && cleanReplyText.trim()) {
          let splitParts = splitTextIntoBubbles(cleanReplyText);
          splitParts.forEach(p => responseItems.push({ kind: 'text', content: p }));
        }

        // 2. 思维链独立存储：不再附着到首条文本消息内容里，而是作为独立 thought 字段保存到首条消息
        //    这样编辑/格式修复/翻译/收藏双击首条消息时不会带上思维链
        let preservedThoughtText = preservedThoughtHeader ? parseThoughtFromText(preservedThoughtHeader).thought : "";

        // 3. 顺序时序队列上屏
        const sessionObj = await db.sessions.get(activeSessionId);
        const userName = sessionObj?.customUserName || "我";

        let currentItemIndex = 0;
        async function processNextResponseItem() {
          if (currentItemIndex < responseItems.length) {
            const item = responseItems[currentItemIndex];
            currentItemIndex++;

            if (item.kind === 'text') {
              // 检测 char 主动发起通话指令 [AUTO_CALL:voice|video]，触发后清洗指令文本
              let textToSave = item.content;
              if (window.callSystem && typeof window.callSystem.detectAndTriggerAutoCall === 'function') {
                textToSave = window.callSystem.detectAndTriggerAutoCall(item.content, reqSessionId);
              }
              // 翻译随动：只附加到第一条 char 文本消息上
              const transForThis = translationText;
              translationText = null;
              // 思维链：只附加到第一条 char 文本消息上（独立字段，不污染正文）
              const thoughtForThis = preservedThoughtText;
              preservedThoughtText = "";
              await saveAndRenderMessage('char', textToSave, 'text', reqSessionId, transForThis, thoughtForThis);
            } else if (item.kind === 'special') {
              await processAndRenderSpecialItem(item, userName, reqSessionId);
            }

            if (currentItemIndex < responseItems.length) {
              const delay = 1000;
              setTimeout(processNextResponseItem, delay);
            } else {
              // 所有气泡上屏完毕后，写入社交动作系统消息（朋友圈/论坛发帖/建立小号等）
              if (pendingSocialNotices.length > 0 && window.socialActions) {
                for (const notice of pendingSocialNotices) {
                  await window.socialActions.writeSysNoticeToChat(activeSessionId, notice);
                }
                pendingSocialNotices = [];
              }
              header.classList.remove("header-typing");
              header.innerText = originalTitle;
              if (typeof checkAndTriggerAutoSummary !== 'undefined') {
                checkAndTriggerAutoSummary(activeSessionId);
              }
            }
          } else {
            // 空队列也需处理社交动作系统消息
            if (pendingSocialNotices.length > 0 && window.socialActions) {
              for (const notice of pendingSocialNotices) {
                await window.socialActions.writeSysNoticeToChat(activeSessionId, notice);
              }
              pendingSocialNotices = [];
            }
            header.classList.remove("header-typing");
            header.innerText = originalTitle;
            if (typeof checkAndTriggerAutoSummary !== 'undefined') {
              checkAndTriggerAutoSummary(activeSessionId);
            }
          }
        }

        if (responseItems.length > 0) {
          await processNextResponseItem();
        } else {
          header.classList.remove("header-typing");
          header.innerText = originalTitle;
          if (typeof checkAndTriggerAutoSummary !== 'undefined') {
            checkAndTriggerAutoSummary(activeSessionId);
          }
        }

      } catch (err) {
        if (err.name === 'AbortError') {
          // 被中止，默默忽略，不触发错误提示卡片
          return;
        }
        console.error(err);
        // 会话隔离：只在用户仍在原会话时才弹错误框，避免跨会话干扰
        if (activeSessionId === reqSessionId) {
          showCustomAlert("API 发生错误", err.message);
        }
      } finally {
        // 会话隔离：只在用户仍在原请求会话时才恢复 header 和按钮 UI
        // 如果用户已切换到其他会话，openWeChatDialog 已经处理了新会话的 UI 状态
        if (activeSessionId === reqSessionId) {
          header.classList.remove("header-typing");
          header.innerText = originalTitle;
          btnReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
        }
        onlineAbortController = null;
      }
    };
  }

  // 3. 输入栏加号展开
  const btnExpand = document.getElementById("btn-chat-expand-toggle");
  if (btnExpand) {
    btnExpand.onclick = () => {
      document.getElementById("chat-expand-panel").classList.toggle("active");
    };
  }

  // 4. 对话配置专属头像本地文件直接存储为原生 Blob 二进制
  const fileChar = document.getElementById("file-details-char");
  const btnChar = document.getElementById("btn-upload-details-char");
  if (btnChar && fileChar) {
    btnChar.onclick = (e) => {
      e.preventDefault();
      fileChar.click();
    };
    fileChar.onchange = (e) => {
      if (e.target.files.length > 0) {
        detailsCharAvatarBlob = e.target.files[0];
        document.getElementById("details-char-avatar").value = "[本地上传图片]";
      }
    };
  }

  const fileUser = document.getElementById("file-details-user");
  const btnUser = document.getElementById("btn-upload-details-user");
  if (btnUser && fileUser) {
    btnUser.onclick = (e) => {
      e.preventDefault();
      fileUser.click();
    };
    fileUser.onchange = (e) => {
      if (e.target.files.length > 0) {
        detailsUserAvatarBlob = e.target.files[0];
        document.getElementById("details-user-avatar").value = "[本地上传图片]";
      }
    };
  }

  // 5. 表情包按钮：打开表情包选择栏
  const btnSticker = document.getElementById("btn-chat-sticker");
  if (btnSticker) {
    btnSticker.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      if (window.stickerSystem && window.stickerSystem.openStickerSelector) {
        window.stickerSystem.openStickerSelector(activeSessionId);
      } else {
        alert("表情包系统尚未初始化，请先刷新页面。");
      }
    };
  }

  // 6. 线下功能唤起
  const btnChatOffline = document.getElementById("btn-chat-offline");
  if (btnChatOffline) {
    btnChatOffline.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      document.getElementById("offline-select-overlay").classList.add("active");
    };
  }

  // 7. HTML 互动卡片唤起 (新增)
  const btnChatHtmlWidget = document.getElementById("btn-chat-html-widget");
  if (btnChatHtmlWidget) {
    btnChatHtmlWidget.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      if (window.chatHtmlWidgetSystem && window.chatHtmlWidgetSystem.openPanel) {
        window.chatHtmlWidgetSystem.openPanel();
      }
    };
  }
}

async function startSingleChat(charId) {
  document.getElementById("new-chat-overlay").classList.remove("active");
  
  try {
    const userIdNum = Number(activeUserPersonaId);
    if (isNaN(userIdNum) || userIdNum <= 0) {
      alert("请先去‘我的’中切换我的人设");
      return;
    }
    const list = await db.sessions.where('userId').equals(userIdNum).toArray();
    let sess = list.find(s => s.charId === Number(charId));
    
    if (!sess) {
      const char = await db.archives.get(charId);
      const user = await db.archives.get(userIdNum);
      sess = {
        userId: userIdNum,
        charId: Number(charId),
        customCharName: char?.name || "",
        customCharAvatar: char?.avatar || null,
        customCharPersona: char?.persona || "",
        customUserName: user?.name || "我",
        customUserAvatar: user?.avatar || null,
        customUserPersona: user?.persona || "",
        lastMessageTime: Date.now()
      };
      sess.id = await db.sessions.add(sess);
    }

    openWeChatDialog(sess.id);
  } catch (err) {
    console.error(err);
    alert("开启聊天失败，详细原因: " + err.message);
  }
}

// 朋友圈 “我的” 子级侧边路由 (钱包渲染适配)
function openMeSub(target) {
  const panel = document.getElementById("me-sub-panel");
  const title = document.getElementById("me-sub-title");
  const body = document.getElementById("me-sub-body");
  const addBtn = document.getElementById("btn-me-sub-add");

  body.innerHTML = "";
  addBtn.style.display = "none";
  panel.classList.add("active");

  if (target === 'collection') {
    title.innerText = "收藏室";
    loadFavoritesList();
  } else if (target === 'wallet') {
    title.innerText = "微信钱包";
    if (window.walletSystem && window.walletSystem.renderWalletPage) {
      window.walletSystem.renderWalletPage(body);
    } else {
      body.innerHTML = `<div style="padding:40px; text-align:center;"><div style="font-size:32px; font-weight:700; color:#1e293b;">￥ 88,888.00</div></div>`;
    }
  }
}

function closeMeSub() {
  document.getElementById("me-sub-panel").classList.remove("active");
}

async function loadFavoritesList() {
  const body = document.getElementById("me-sub-body");
  const personaId = Number(localStorage.getItem("active_me_id") || 0);

  // 获取当前面具下的所有会话
  const sessions = await db.sessions.where('userId').equals(personaId).toArray();
  const sessionMap = {};
  sessions.forEach(s => { sessionMap[s.id] = s; });
  const sessionIds = sessions.map(s => s.id);

  // 加载收藏的线上消息（仅限当前面具的会话）
  let favs = [];
  if (sessionIds.length > 0) {
    favs = await db.messages.filter(m => m.isFavorite === 1 && sessionIds.includes(m.sessionId)).toArray();
  }
  // 加载收藏的线下消息
  const offlineFavs = await db.offline_messages.filter(m => m.isFavorite === 1).toArray();
  // 加载 favorites 表的生图收藏（按当前面具过滤）
  let favRecords = [];
  if (personaId) {
    favRecords = await db.favorites.where('userId').equals(personaId).toArray();
  }

  // 合并并标注来源
  const allFavs = [
    ...favs.map(m => ({ ...m, source: 'online' })),
    ...offlineFavs.map(m => ({ ...m, source: 'offline' })),
    // favorites 表记录转换为类似 message 的结构
    ...favRecords.map(r => ({
      id: 'fav_' + r.id,
      sessionId: r.sessionId,
      contentType: r.msgType || 'image',
      content: r.content,
      timestamp: r.createdAt,
      source: 'favorites',
      favId: r.id
    }))
  ];

  if (allFavs.length === 0) {
    body.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-secondary); font-size:13px;">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3; margin-bottom:8px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      <div>暂无收藏记录</div>
      <div style="font-size:11px; margin-top:4px;">双击图片打开工具栏可选择「收藏」</div>
    </div>`;
    return;
  }

  // 按会话分组
  const grouped = {};
  allFavs.forEach(f => {
    const sid = f.sessionId || 'offline';
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push(f);
  });

  // 渲染框架：类型筛选 + 分组列表
  body.innerHTML = `
    <div id="fav-type-filter" style="display:flex; gap:6px; padding:8px 12px; border-bottom:1px solid var(--border); overflow-x:auto; flex-shrink:0;">
      <button class="fav-filter-btn active" data-type="all" style="padding:4px 12px; font-size:11px; font-weight:700; border-radius:12px; border:none; background:#1e293b; color:#fff; cursor:pointer; white-space:nowrap;">全部</button>
      <button class="fav-filter-btn" data-type="text" style="padding:4px 12px; font-size:11px; font-weight:600; border-radius:12px; border:1px solid var(--border); background:#fff; color:var(--text-secondary); cursor:pointer; white-space:nowrap;">文字</button>
      <button class="fav-filter-btn" data-type="voice" style="padding:4px 12px; font-size:11px; font-weight:600; border-radius:12px; border:1px solid var(--border); background:#fff; color:var(--text-secondary); cursor:pointer; white-space:nowrap;">语音</button>
      <button class="fav-filter-btn" data-type="image" style="padding:4px 12px; font-size:11px; font-weight:600; border-radius:12px; border:1px solid var(--border); background:#fff; color:var(--text-secondary); cursor:pointer; white-space:nowrap;">图片</button>
      <button class="fav-filter-btn" data-type="other" style="padding:4px 12px; font-size:11px; font-weight:600; border-radius:12px; border:1px solid var(--border); background:#fff; color:var(--text-secondary); cursor:pointer; white-space:nowrap;">其他</button>
    </div>
    <div id="fav-list-container" style="overflow-y:auto; flex:1; padding:8px 0;"></div>
  `;

  const container = document.getElementById("fav-list-container");

  // 判断消息类型
  function getFavType(f) {
    if (f.contentType === 'voice') return 'voice';
    if (f.contentType === 'image') return 'image';
    if (!f.contentType || f.contentType === 'text') return 'text';
    return 'other';
  }

  // 渲染单条收藏
  function renderFavItem(f) {
    const type = getFavType(f);
    const session = sessionMap[f.sessionId];
    const sessionName = session ? (session.customCharName || '未知对话') : (f.source === 'offline' ? '线下小剧场' : '未知对话');
    const timeStr = new Date(f.timestamp).toLocaleString();

    const item = document.createElement("div");
    item.className = "fav-item";
    item.setAttribute("data-fav-type", type);
    item.style.cssText = "background:var(--surface); margin:6px 12px; border-radius:12px; padding:12px; border:1px solid var(--border); position:relative;";

    let contentHtml = '';
    if (type === 'voice') {
      try {
        const voiceData = JSON.parse(f.content);
        const duration = voiceData.duration || 0;
        const voiceText = voiceData.text || '语音消息';
        const barWidth = Math.min(160, 60 + duration * 3);
        contentHtml = `
          <div style="display:flex; align-items:center; gap:8px;">
            <button onclick="playFavVoice('${escapeHtml(voiceText).replace(/'/g, "\\'")}', ${f.id})" style="width:32px; height:32px; border-radius:50%; border:none; background:#07c160; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <div style="flex:1; min-width:0;">
              <div style="height:20px; background:#07c160; opacity:0.2; border-radius:3px; width:${barWidth}px; max-width:100%;"></div>
              <div style="font-size:10px; color:#999; margin-top:2px;">${duration}"</div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--text-primary); margin-top:6px; word-break:break-all; opacity:0.8;">${escapeHtml(voiceText)}</div>
        `;
      } catch(e) {
        contentHtml = `<div style="font-size:12px; color:#999;">[语音消息]</div>`;
      }
    } else if (type === 'image') {
      // 生图收藏（favorites 表）：content 直接是 dataURL，description 为图片描述
      if (f.source === 'favorites' && f.content && f.content.startsWith('data:image/')) {
        const favDesc = f.description || '';
        const favDescAttr = favDesc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        contentHtml = `<img src="${f.content}" style="max-width:100%; max-height:160px; border-radius:8px; margin-top:4px; cursor:zoom-in;" onclick="if(window.imageGenSystem)window.imageGenSystem.openFullScreenImage('${f.content.replace(/'/g, "\\'")}', {description: '${favDescAttr}'})">` +
          (favDesc ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:4px; line-height:1.5;">${escapeHtml(favDesc)}</div>` : '');
      } else {
        try {
          const imgData = JSON.parse(f.content);
          const imgUrl = imgData.url || '';
          const hdUrl = imgData.hdUrl || imgUrl;
          if (imgUrl && imgUrl.startsWith('data:image/')) {
            const imgDesc = imgData.text || '';
            const imgDescAttr = imgDesc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            contentHtml = `<img src="${imgUrl}" style="max-width:100%; max-height:120px; border-radius:8px; margin-top:4px; cursor:zoom-in;" onclick="if(window.imageGenSystem)window.imageGenSystem.openFullScreenImage('${imgUrl.replace(/'/g, "\\'")}', {description: '${imgDescAttr}', hdSrc: '${hdUrl.replace(/'/g, "\\'")}'})">` +
              (imgDesc ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:4px; line-height:1.5;">${escapeHtml(imgDesc)}</div>` : '');
          } else {
            contentHtml = `<div style="font-size:12px; color:var(--text-primary);">${escapeHtml(imgData.text || f.content)}</div>`;
          }
        } catch(e) {
          contentHtml = `<div style="font-size:12px; color:var(--text-primary); word-break:break-all;">${escapeHtml(f.content)}</div>`;
        }
      }
    } else {
      contentHtml = `<div style="font-size:13px; color:var(--text-primary); word-break:break-all; font-weight:500;">${escapeHtml(f.content)}</div>`;
    }

    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="font-size:10px; font-weight:700; color:var(--primary); background:var(--primary-light); padding:1px 6px; border-radius:4px;">${escapeHtml(sessionName)}</span>
          <span style="font-size:9px; color:var(--text-secondary);">${f.source === 'offline' ? '线下' : '线上'}</span>
        </div>
        <button onclick="removeFavorite('${f.id}', '${f.source}')" style="width:22px; height:22px; border:none; background:none; cursor:pointer; color:#ef4444; display:flex; align-items:center; justify-content:center; border-radius:4px;" title="删除收藏">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      ${contentHtml}
      <div style="font-size:9px; color:var(--text-secondary); margin-top:6px;">收藏于 ${timeStr}</div>
    `;
    return item;
  }

  // 按会话分组渲染
  function renderGroupedFavorites(filterType) {
    container.innerHTML = "";
    let totalShown = 0;

    Object.keys(grouped).forEach(sid => {
      const items = grouped[sid].sort((a, b) => b.timestamp - a.timestamp);
      const filtered = filterType === 'all' ? items : items.filter(f => getFavType(f) === filterType);
      if (filtered.length === 0) return;

      const session = sessionMap[sid];
      const sessionName = session ? (session.customCharName || '未知对话') : (sid === 'offline' ? '线下小剧场' : '未知对话');

      const groupHeader = document.createElement("div");
      groupHeader.style.cssText = "padding:8px 14px 4px; font-size:11px; font-weight:700; color:var(--text-secondary); display:flex; align-items:center; gap:4px;";
      groupHeader.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ${escapeHtml(sessionName)} (${filtered.length})
      `;
      container.appendChild(groupHeader);

      filtered.forEach(f => {
        container.appendChild(renderFavItem(f));
        totalShown++;
      });
    });

    if (totalShown === 0) {
      container.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-secondary); font-size:12px;">该分类下暂无收藏</div>`;
    }
  }

  // 初始渲染全部
  renderGroupedFavorites('all');

  // 绑定筛选按钮
  document.querySelectorAll(".fav-filter-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".fav-filter-btn").forEach(b => {
        b.classList.remove("active");
        b.style.background = "#fff";
        b.style.color = "var(--text-secondary)";
        b.style.border = "1px solid var(--border)";
        b.style.fontWeight = "600";
      });
      btn.classList.add("active");
      btn.style.background = "#1e293b";
      btn.style.color = "#fff";
      btn.style.border = "none";
      btn.style.fontWeight = "700";
      renderGroupedFavorites(btn.getAttribute("data-type"));
    };
  });
}

// 播放收藏的语音消息（不受3天缓存清理影响）
function playFavVoice(voiceText, msgId) {
  if (window.ttsSystem) {
    const sessionId = activeSessionId || null;
    window.ttsSystem.getOrSynthesize(voiceText, null, sessionId).then(blob => {
      if (blob) {
        window.ttsSystem.playBlob(blob);
      } else {
        showToast("语音播放失败，请检查 TTS 配置");
      }
    });
  } else {
    showToast("TTS 系统未加载");
  }
}

// 删除收藏（仅手动删除）
async function removeFavorite(msgId, source) {
  // msgId 可能是数字（messages 表）或字符串 'fav_xxx'（favorites 表）
  if (source === 'favorites') {
    // favorites 表的生图收藏记录，直接删除
    let realId = msgId;
    if (typeof msgId === 'string' && msgId.startsWith('fav_')) {
      realId = Number(msgId.replace('fav_', ''));
    } else {
      realId = Number(msgId);
    }
    await db.favorites.delete(realId);
  } else if (source === 'offline') {
    await db.offline_messages.update(Number(msgId), { isFavorite: 0 });
  } else {
    await db.messages.update(Number(msgId), { isFavorite: 0 });
  }
  showToast("已从收藏室移除");
  loadFavoritesList();
}

// 专属设置安全加载
const btnDialogDetails = document.getElementById("btn-dialog-details");
if (btnDialogDetails) {
  btnDialogDetails.onclick = async () => {
    if (!activeSessionId) {
      alert("当前无活跃对话，请先开启一个会话。");
      return;
    }
    try {
      const sess = await db.sessions.get(activeSessionId);
      if (!sess) {
        throw new Error("无法从数据库加载当前会话记录！");
      }

      // 核心拦截：如果是群聊，直接打开群聊专属后台，防止与单聊后台重叠
      if (sess.isGroup === 1) {
        if (window.groupChatSystem && typeof window.groupChatSystem.openGroupDetailsPanel === 'function') {
          window.groupChatSystem.openGroupDetailsPanel();
        }
        return;
      }

      const char = sess.charId ? await db.archives.get(sess.charId) : null;
      const user = sess.userId ? await db.archives.get(sess.userId) : null;

      document.getElementById("details-char-name").value = sess.customCharName || char?.name || "";
      
      const cAvatar = sess.customCharAvatar || char?.avatar;
      document.getElementById("details-char-avatar").value = (cAvatar instanceof Blob) ? "[本地上传图片]" : (cAvatar || "");
      detailsCharAvatarBlob = (cAvatar instanceof Blob) ? cAvatar : null;

      document.getElementById("details-char-persona").value = sess.customCharPersona || char?.persona || "";
      document.getElementById("details-user-name").value = sess.customUserName || user?.name || "";
      
      const uAvatar = sess.customUserAvatar || user?.avatar;
      document.getElementById("details-user-avatar").value = (uAvatar instanceof Blob) ? "[本地上传图片]" : (uAvatar || "");
      detailsUserAvatarBlob = (uAvatar instanceof Blob) ? uAvatar : null;

      document.getElementById("details-user-persona").value = sess.customUserPersona || user?.persona || "";
      
      // 渲染单聊专属世界书手风琴选择器
      const containerEl = document.getElementById("details-wb-mounted-accordion");
      if (containerEl && typeof renderWbMountedAccordion === 'function') {
        await renderWbMountedAccordion(containerEl, sess.mountedEntryIds || [], "cb-details-wb-mount");
      }

      // 渲染多媒体、时间感知等全新状态设置开关
      document.getElementById("details-status-auto").checked = !!sess.statusAutoToggle;
      document.getElementById("details-translate-auto").checked = !!sess.translateAutoToggle;
      document.getElementById("details-multimedia-toggle").checked = !!sess.multimediaToggle;
      document.getElementById("details-allow-recall-toggle").checked = !!sess.allowCharRecall;
      document.getElementById("details-allow-reaction-toggle").checked = !!sess.allowCharReaction;
      document.getElementById("details-allow-char-block").checked = !!sess.allowCharToBlock;

      // 渲染 TTS 语音开关与音色 ID，并绑定开关展开/收起
      const ttsToggle = document.getElementById("details-tts-toggle");
      const ttsVoiceContainer = document.getElementById("details-tts-voice-container");
      if (ttsToggle) {
        ttsToggle.checked = !!sess.ttsEnabled;
        if (ttsVoiceContainer) ttsVoiceContainer.style.display = ttsToggle.checked ? "block" : "none";
        ttsToggle.onchange = function() {
          if (ttsVoiceContainer) ttsVoiceContainer.style.display = this.checked ? "block" : "none";
        };
      }
      const ttsVoiceIdEl = document.getElementById("details-tts-voice-id");
      if (ttsVoiceIdEl) ttsVoiceIdEl.value = sess.ttsVoiceId || "";

      // 渲染 char 主动发起通话开关与视频通话子开关
      const autoCallToggle = document.getElementById("details-autocall-toggle");
      const autoCallVideoContainer = document.getElementById("details-autocall-video-container");
      if (autoCallToggle) {
        autoCallToggle.checked = !!sess.allowCharAutoCall;
        if (autoCallVideoContainer) autoCallVideoContainer.style.display = autoCallToggle.checked ? "flex" : "none";
        autoCallToggle.onchange = function() {
          if (autoCallVideoContainer) autoCallVideoContainer.style.display = this.checked ? "flex" : "none";
        };
      }
      const autoCallVideoToggle = document.getElementById("details-autocall-video-toggle");
      if (autoCallVideoToggle) autoCallVideoToggle.checked = !!sess.allowCharAutoCallVideo;

      // 渲染自动发朋友圈开关
      const autoMomentToggle = document.getElementById("details-auto-moment-toggle");
      if (autoMomentToggle) autoMomentToggle.checked = !!sess.allowCharAutoMoment;

      // 渲染论坛漫游开关与建立小号子开关
      const forumRoamToggle = document.getElementById("details-auto-forum-roam-toggle");
      const forumAltContainer = document.getElementById("details-forum-alt-container");
      if (forumRoamToggle) {
        forumRoamToggle.checked = !!sess.allowCharForumRoam;
        if (forumAltContainer) forumAltContainer.style.display = forumRoamToggle.checked ? "flex" : "none";
        forumRoamToggle.onchange = function() {
          if (forumAltContainer) forumAltContainer.style.display = this.checked ? "flex" : "none";
        };
      }
      const forumAltAllowToggle = document.getElementById("details-forum-alt-allow-toggle");
      if (forumAltAllowToggle) forumAltAllowToggle.checked = !!sess.allowCharForumAltAccount;

      // 渲染分句粒度控制设置
      const minSentencesEl = document.getElementById("details-min-sentences");
      const maxSentencesEl = document.getElementById("details-max-sentences");
      if (minSentencesEl) minSentencesEl.value = sess.minSentenceCount || 1;
      if (maxSentencesEl) maxSentencesEl.value = sess.maxSentenceCount || 3;

      // 更新拉黑状态按钮文本
      const btnDetailsBlockChar = document.getElementById("btn-details-block-char");
      if (btnDetailsBlockChar) {
        btnDetailsBlockChar.innerText = sess.isBlockedByUser === 1 ? "解除拉黑" : "拉黑对方";
      }
      
      const timeToggle = document.getElementById("details-time-toggle");
          // 核心修复：用 !== 0 表达式，精准阻断 0 的宽松映射，锁定详情页自定义关闭状态
          timeToggle.checked = sess.timePerceptionToggle !== 0; 
          
          const customTimeContainer = document.getElementById("details-custom-time-container");
          if (customTimeContainer && timeToggle) {
            customTimeContainer.style.display = timeToggle.checked ? "none" : "block";
            // 核心绑定：开关切换瞬间即时展开/隐藏自定义时间栏
            timeToggle.onchange = function() {
              customTimeContainer.style.display = this.checked ? "none" : "block";
            };
          }

          if (sess.customTimeData) {
        try {
          const td = JSON.parse(sess.customTimeData);
          document.getElementById("details-time-year").value = td.year || 2026;
          document.getElementById("details-time-month").value = td.month || 1;
          document.getElementById("details-time-day").value = td.day || 1;
          document.getElementById("details-time-hour").value = td.hour || 12;
          document.getElementById("details-time-minute").value = td.minute || 0;
        } catch(e) {}
      }

      // 渲染表情包挂载列表
      const mountedStickersEl = document.getElementById("details-mounted-stickers");
      const mountBtn = document.getElementById("btn-details-sticker-mount");
      if (mountedStickersEl && mountBtn) {
        if (typeof stickerSystem !== 'undefined' && stickerSystem.init) {
          await stickerSystem.init();
          const mountedIds = await stickerSystem.getMountedGroupIds(activeSessionId);
          if (mountedIds.length > 0) {
            const names = stickerSystem.stickerGroups
              ? stickerSystem.stickerGroups.filter(g => mountedIds.includes(g.id)).map(g => g.name)
              : [];
            mountedStickersEl.textContent = names.length > 0 ? names.join('、') : '已挂载 ' + mountedIds.length + ' 个分组';
          } else {
            mountedStickersEl.textContent = '暂无挂载';
          }
        } else {
          mountedStickersEl.textContent = '暂无挂载';
        }
        mountBtn.onclick = async () => {
          if (typeof stickerSystem !== 'undefined' && stickerSystem.openStickerMountSettings) {
            await stickerSystem.openStickerMountSettings(activeSessionId);
          }
        };
      }

      document.getElementById("chat-details-panel").classList.add("active");
    } catch (err) {
      console.error(err);
      alert(`加载设置失败: ${err.message}`);
    }
  };
}

function closeChatDetails() {
  document.getElementById("chat-details-panel").classList.remove("active");
}

const btnSaveDetails = document.getElementById("btn-save-details");
if (btnSaveDetails) {
  btnSaveDetails.onclick = async () => {
    const charName = document.getElementById("details-char-name").value.trim();
    const charAvatarInput = document.getElementById("details-char-avatar").value.trim();
    
    let charAvatar = null;
    if (charAvatarInput === "[本地上传图片]") {
      charAvatar = detailsCharAvatarBlob; 
    } else {
      charAvatar = charAvatarInput; 
    }

    const charPersona = document.getElementById("details-char-persona").value.trim();
    const userName = document.getElementById("details-user-name").value.trim();
    const userAvatarInput = document.getElementById("details-user-avatar").value.trim();
    
    let userAvatar = null;
    if (userAvatarInput === "[本地上传图片]") {
      userAvatar = detailsUserAvatarBlob; 
    } else {
      userAvatar = userAvatarInput;
    }

    const userPersona = document.getElementById("details-user-persona").value.trim();

    // 从手风琴选择器中精准抓取选中的世界书条目 ID 列表
    const checkedBoxes = document.querySelectorAll(".cb-details-wb-mount:checked");
    const mountedEntryIds = Array.from(checkedBoxes).map(cb => Number(cb.value));

    // 获取并写入全新的多媒体、时间模拟器属性
    const statusAutoToggle = document.getElementById("details-status-auto").checked;
    const translateAutoToggle = document.getElementById("details-translate-auto").checked;
    const multimediaToggle = document.getElementById("details-multimedia-toggle").checked;
    const timePerceptionToggle = document.getElementById("details-time-toggle").checked;
    const allowCharRecall = document.getElementById("details-allow-recall-toggle").checked;
    const allowCharReaction = document.getElementById("details-allow-reaction-toggle").checked;
    const allowCharToBlock = document.getElementById("details-allow-char-block").checked;

    // 读取 TTS 语音开关与音色 ID
    const ttsToggleEl = document.getElementById("details-tts-toggle");
    const ttsEnabled = ttsToggleEl ? (ttsToggleEl.checked ? 1 : 0) : 0;
    const ttsVoiceIdEl = document.getElementById("details-tts-voice-id");
    const ttsVoiceId = ttsVoiceIdEl ? (ttsVoiceIdEl.value || "").trim() : "";

    // 读取 char 主动发起通话开关
    const autoCallToggleEl = document.getElementById("details-autocall-toggle");
    const allowCharAutoCall = autoCallToggleEl ? (autoCallToggleEl.checked ? 1 : 0) : 0;
    const autoCallVideoToggleEl = document.getElementById("details-autocall-video-toggle");
    const allowCharAutoCallVideo = autoCallVideoToggleEl ? (autoCallVideoToggleEl.checked ? 1 : 0) : 0;

    // 读取自动发朋友圈、论坛漫游、建立小号开关
    const autoMomentToggleEl = document.getElementById("details-auto-moment-toggle");
    const allowCharAutoMoment = autoMomentToggleEl ? (autoMomentToggleEl.checked ? 1 : 0) : 0;
    const forumRoamToggleEl = document.getElementById("details-auto-forum-roam-toggle");
    const allowCharForumRoam = forumRoamToggleEl ? (forumRoamToggleEl.checked ? 1 : 0) : 0;
    const forumAltAllowToggleEl = document.getElementById("details-forum-alt-allow-toggle");
    const allowCharForumAltAccount = forumAltAllowToggleEl ? (forumAltAllowToggleEl.checked ? 1 : 0) : 0;

    const timeData = {
      year: parseInt(document.getElementById("details-time-year").value) || 2026,
      month: parseInt(document.getElementById("details-time-month").value) || 1,
      day: parseInt(document.getElementById("details-time-day").value) || 1,
      hour: parseInt(document.getElementById("details-time-hour").value) || 12,
      minute: parseInt(document.getElementById("details-time-minute").value) || 0
    };

    const minSentenceCount = parseInt(document.getElementById("details-min-sentences")?.value) || 1;
    const maxSentenceCount = parseInt(document.getElementById("details-max-sentences")?.value) || 3;

    await db.sessions.update(activeSessionId, {
      customCharName: charName,
      customCharAvatar: charAvatar,
      customCharPersona: charPersona,
      customUserName: userName,
      customUserAvatar: userAvatar,
      customUserPersona: userPersona,
      mountedEntryIds: mountedEntryIds,
      statusAutoToggle: statusAutoToggle ? 1 : 0,
      translateAutoToggle: translateAutoToggle ? 1 : 0,
      multimediaToggle: multimediaToggle ? 1 : 0,
      timePerceptionToggle: timePerceptionToggle ? 1 : 0,
      allowCharRecall: allowCharRecall ? 1 : 0,
      allowCharReaction: allowCharReaction ? 1 : 0,
      allowCharToBlock: allowCharToBlock ? 1 : 0,
      ttsEnabled: ttsEnabled,
      ttsVoiceId: ttsVoiceId,
      allowCharAutoCall: allowCharAutoCall,
      allowCharAutoCallVideo: allowCharAutoCallVideo,
      allowCharAutoMoment: allowCharAutoMoment,
      allowCharForumRoam: allowCharForumRoam,
      allowCharForumAltAccount: allowCharForumAltAccount,
      minSentenceCount: minSentenceCount,
      maxSentenceCount: maxSentenceCount,
      customTimeData: JSON.stringify(timeData),
      customTimeSavedAt: Date.now() // 核心写入：场景自定义时间的物理起始基准时间戳
    });

    activeSessionCharAvatar = charAvatar;
    activeSessionUserAvatar = userAvatar;

    showToast("当前对话专属设定已成功保存并在此对话内独立生效。");
    closeChatDetails();
    document.getElementById("dialog-header-title").innerText = charName;
    
    renderDialogMessages();
  };
}

async function saveAndRenderMessage(senderType, content, contentType = 'text', overrideSessionId = null, translation = null, thought = null) {
  const sid = overrideSessionId || activeSessionId;
  const sess = await db.sessions.get(sid);
  const isBlocked = (senderType === 'user' && sess?.isBlockedByChar === 1) || (senderType === 'char' && sess?.isBlockedByUser === 1) ? 1 : 0;
  const msg = {
    sessionId: sid,
    senderType,
    senderId: senderType === 'user' ? Number(activeUserPersonaId) : 0,
    content,
    contentType,
    timestamp: Date.now(),
    isBlocked: isBlocked
  };
  if (translation) {
    msg.translatedContent = translation;
    msg.showTranslation = 1;
  }
  if (thought) {
    msg.thought = thought;
  }
  msg.id = await db.messages.add(msg);
  await appendMessageToDOM(msg);

  if (senderType === 'char' && localStorage.getItem("settings-background-enabled") === "true") {
    const sess = await db.sessions.get(sid);
    const char = sess ? await db.archives.get(sess.charId) : null;
    const senderName = sess?.customCharName || char?.name || "对方";
    let cleanText = content;
    if (contentType === 'voice') cleanText = "[语音消息]";
    else if (contentType === 'image') cleanText = "[图片与描述]";
    else if (contentType === 'transfer') cleanText = "[微信转账]";
    else if (contentType === 'red_envelope') cleanText = "[微信红包]";
    // APK 环境优先使用 AndroidMCP 原生通知
    if (window.AndroidMCP && typeof window.AndroidMCP.showSystemNotification === 'function') {
      window.AndroidMCP.showSystemNotification(senderName, cleanText);
    } else if ('Notification' in window) {
      // 浏览器环境 fallback：Web Notification API（页面后台/最小化时也能弹出）
      try {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
        if (Notification.permission === 'granted') {
          // 头像优先用网络 URL 字符串，否则回落到 icon-192.png（Blob 类型无法跨 SW 传递）
          const avatarSrc = (char && typeof char.avatar === 'string' && char.avatar) ? char.avatar : './icon-192.png';
          const options = {
            body: cleanText,
            icon: avatarSrc,
            tag: `chat-${sid}`,
            requireInteraction: false
          };
          // 优先通过 service worker 显示（后台/最小化也能显示）
          const reg = window._swRegistration || (await navigator.serviceWorker?.getRegistration?.());
          if (reg && typeof reg.showNotification === 'function') {
            reg.showNotification(senderName, options);
          } else {
            new Notification(senderName, options);
          }
        }
      } catch (e) {
        console.warn('Web Notification 发送失败:', e);
      }
    }
  }
}

// 语音消息与图片场景描述展开机制挂载（支持与翻译显示状态同步存库）
// 当对话详情开启 TTS 时，点击 AI 语音消息会展开文字卡片并将文字转换为语音播放（本地缓存 3 天）
window.toggleVoiceTranslation = async function(msgId, el) {
  const textEl = document.getElementById(`voice-trans-${msgId}`);
  if (!textEl) return;
  const isHidden = textEl.style.display === 'none';
  textEl.style.display = isHidden ? 'block' : 'none';
  const msg = await db.messages.get(Number(msgId));
  if (msg && msg.translatedContent) {
    await db.messages.update(Number(msgId), { showTranslation: isHidden ? 1 : 0 });
  }

  // TTS 语音转换播放：仅当本会话开启 TTS 且为对方(char)发送的语音消息时触发
  if (typeof window.ttsSystem === 'undefined' || !activeSessionId) return;
  try {
    const sess = await db.sessions.get(activeSessionId);
    if (!sess || sess.ttsEnabled !== 1) return;
    if (!msg || msg.senderType !== 'char' || msg.contentType !== 'voice') return;

    if (!isHidden) {
      // 收起：停止当前 TTS 播放
      window.ttsSystem.stop();
      return;
    }
    // 展开：解析语音消息文字并合成播放
    let voiceText = '';
    try {
      const data = JSON.parse(msg.content);
      voiceText = (data && data.text) ? data.text : '';
    } catch (e) { voiceText = ''; }
    if (!voiceText) return;

    let voiceId = (sess.ttsVoiceId || '').trim();
    if (!voiceId) {
      voiceId = 'male-qn-jingying';
      showToast('未填写音色 ID，已使用默认音色。可在对话详情中设置。');
    }
    showToast('正在转换 TTS 语音…');
    const blob = await window.ttsSystem.getOrSynthesize(voiceText, voiceId, activeSessionId);
    if (blob) {
      window.ttsSystem.playBlob(blob);
    }
  } catch (e) {
    console.warn('[TTS] 语音播放失败', e);
  }
};
window.toggleImageText = async function(msgId, el) {
  const textEl = document.getElementById(`image-desc-${msgId}`);
  if (textEl) {
    const isHidden = textEl.style.display === 'none';
    textEl.style.display = isHidden ? 'block' : 'none';
    const msg = await db.messages.get(Number(msgId));
    if (msg && msg.translatedContent) {
      await db.messages.update(Number(msgId), { showTranslation: isHidden ? 1 : 0 });
    }
  }
};

// ============================================================
//             线下业务交互逻辑
// ============================================================

function closeOfflineSelect() {
  document.getElementById("offline-select-overlay").classList.remove("active");
}

function triggerTheaterMode() {
  closeOfflineSelect();
  document.getElementById("win-theater-list").classList.add("active");
  renderTheaterList();
}

let editingTheaterId = null;

async function renderTheaterList() {
  const container = document.getElementById("theater-list-container");
  if (!container) return;
  container.innerHTML = "";

  const theaters = await db.theaters.where('sessionId').equals(activeSessionId).toArray();
  if (theaters.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">暂无独立剧场，点击右上角新建一个剧场</p>`;
    return;
  }

  theaters.forEach(th => {
    const card = document.createElement("div");
    card.className = "archive-card";
    card.style.cssText = "margin-bottom: 10px;";
    card.innerHTML = `
      <div class="card-info" onclick="enterTheater(${th.id})" style="cursor:pointer; flex: 1;">
        <div class="card-name">${escapeHtml(th.name)}</div>
        <div class="card-desc">每轮字数: ${th.minWordCount}-${th.maxWordCount} | 视角: ${th.charPOV || '第三人称'}/${th.userPOV || '第二人称'}</div>
      </div>
      <div class="card-actions">
        <button class="btn-icon" onclick="openEditTheaterForm(${th.id})" title="编辑剧场">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
        </button>
        <button class="btn-icon btn-delete" onclick="deleteTheater(${th.id})" title="删除剧场">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function openNewTheaterForm() {
  editingTheaterId = null;
  document.getElementById("theater-name").value = "";
  document.getElementById("theater-scenario").value = "";
  document.getElementById("theater-min-word").value = 50;
  document.getElementById("theater-max-word").value = 300;
  document.getElementById("theater-carry-memory").checked = true;
  document.getElementById("theater-char-pov").value = "第三人称";
  document.getElementById("theater-user-pov").value = "第二人称";
  document.getElementById("new-theater-overlay").classList.add("active");
}

async function openEditTheaterForm(theaterId) {
  editingTheaterId = theaterId;
  const th = await db.theaters.get(Number(theaterId));
  if (!th) return;

  document.getElementById("theater-name").value = th.name || "";
  document.getElementById("theater-scenario").value = th.scenario || "";
  document.getElementById("theater-min-word").value = th.minWordCount || 50;
  document.getElementById("theater-max-word").value = th.maxWordCount || 300;
  document.getElementById("theater-carry-memory").checked = !!th.carryMemory;
  document.getElementById("theater-char-pov").value = th.charPOV || "第三人称";
  document.getElementById("theater-user-pov").value = th.userPOV || "第二人称";
  document.getElementById("new-theater-overlay").classList.add("active");
}

function closeNewTheaterForm() {
  document.getElementById("new-theater-overlay").classList.remove("active");
  editingTheaterId = null;
}

async function saveNewTheater() {
  const name = document.getElementById("theater-name").value.trim();
  const scenario = document.getElementById("theater-scenario").value.trim();
  const minWord = Number(document.getElementById("theater-min-word").value) || 50;
  const maxWord = Number(document.getElementById("theater-max-word").value) || 300;
  const carryMemory = document.getElementById("theater-carry-memory").checked;
  const charPOV = document.getElementById("theater-char-pov").value;
  const userPOV = document.getElementById("theater-user-pov").value;

  if (!name || !scenario) {
    showToast("请完整填写剧场名称与情景设定！");
    return;
  }

  if (editingTheaterId) {
    await db.theaters.update(Number(editingTheaterId), {
      name,
      scenario,
      minWordCount: minWord,
      maxWordCount: maxWord,
      carryMemory: carryMemory ? 1 : 0,
      charPOV,
      userPOV
    });
    showToast("剧场配置更新成功！");
    closeNewTheaterForm();
    renderTheaterList();
  } else {
    const theaterId = await db.theaters.add({
      sessionId: activeSessionId,
      name,
      scenario,
      minWordCount: minWord,
      maxWordCount: maxWord,
      carryMemory: carryMemory ? 1 : 0,
      charPOV,
      userPOV,
      createdAt: Date.now()
    });

    closeNewTheaterForm();
    closeTheaterList();
    enterTheater(theaterId);
  }
}

async function deleteTheater(id) {
  if (confirm("确定要删除该独立剧场及其中所有的线下卡片记录吗？")) {
    await db.theaters.delete(id);
    await db.offline_messages.where('theaterId').equals(id).delete();
    renderTheaterList();
  }
}

function closeTheaterList() {
  document.getElementById("win-theater-list").classList.remove("active");
}

function enterTheater(theaterId) {
  isOfflineTheater = true;
  activeTheaterId = theaterId;
  exitOfflineMultiSelectMode();
  
  // 同步清空旧剧场白描记录，消除进入剧场转场时的内容残留闪动
  const container = document.getElementById("offline-messages-flow");
  if (container) container.innerHTML = "";
  
  // 核心检测：判断会话类型，若是群聊则下架隐藏线下粉色心声状态按钮
  db.sessions.get(activeSessionId).then(sess => {
    const btnOfflineStatus = document.getElementById("btn-offline-char-status");
    if (btnOfflineStatus) {
      btnOfflineStatus.style.display = (sess && sess.isGroup === 1) ? "none" : "flex";
    }
  });

  db.theaters.get(theaterId).then(th => {
    document.getElementById("offline-chat-title").innerText = `独立剧场：${th.name}`;
    document.getElementById("win-offline-chat").classList.add("active");
    renderOfflineMessages();
  });
}

function triggerAppointmentMode() {
  closeOfflineSelect();
  isOfflineTheater = false;
  activeTheaterId = 0;
  exitOfflineMultiSelectMode();

  // 同步清空旧赴约对白记录，消除进入赴约转场时的内容残留闪动
  const container = document.getElementById("offline-messages-flow");
  if (container) container.innerHTML = "";

  // 核心检测：判断会话类型，若是群聊则下架隐藏线下粉色心声状态按钮
  db.sessions.get(activeSessionId).then(sess => {
    const btnOfflineStatus = document.getElementById("btn-offline-char-status");
    if (btnOfflineStatus) {
      btnOfflineStatus.style.display = (sess && sess.isGroup === 1) ? "none" : "flex";
    }
  });

  document.getElementById("offline-chat-title").innerText = "赴约中...";
  document.getElementById("win-offline-chat").classList.add("active");
  renderOfflineMessages();
}

function exitOfflineChat() {
  document.getElementById("win-offline-chat").classList.remove("active");
}

// 线下折叠思维链交互开关 (控制卡片延伸与小三角旋转)
window.toggleOfflineCotBody = function(cardId) {
  const body = document.getElementById(`${cardId}-body`);
  const chevron = document.getElementById(`${cardId}-chevron`);
  if (body) {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (chevron) {
      chevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
    }
  }
};

// 渲染线下独立白描段落卡片 (支持卡片内嵌式思维链 CoT 动态折叠)
async function renderOfflineMessages() {
  const container = document.getElementById("offline-messages-flow");
  if (!container) return;
  container.innerHTML = "";

  let msgs = [];
  if (isOfflineTheater) {
    msgs = await db.offline_messages
      .where('theaterId').equals(activeTheaterId)
      .sortBy('timestamp');
  } else {
    msgs = await db.offline_messages
      .where('sessionId').equals(activeSessionId)
      .and(m => m.isTheater === 0)
      .sortBy('timestamp');
  }

  const sess = await db.sessions.get(activeSessionId);
  const char = await db.archives.get(sess.charId);
  const user = await db.archives.get(sess.userId);
  const charName = sess.customCharName || char?.name || "对方";
  const userName = sess.customUserName || user?.name || "我";

  const fragment = document.createDocumentFragment();
  for (const m of msgs) {
    const parsedCot = parseThoughtFromText(m.content, activeSessionId);

    const card = document.createElement("div");
    card.className = `offline-card ${m.senderType === 'user' ? 'user' : 'char'}`;
    card.setAttribute("data-msg-id", m.id);

    card.ondblclick = (e) => {
      e.preventDefault();
      if (isOfflineMultiSelectMode) return;
      activeOfflineSelectedMsgId = Number(m.id);
      document.getElementById("offline-bubble-context-menu").style.display = "flex";
    };

    const senderLabel = m.senderType === 'user' ? userName : charName;
    const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let cotHtml = "";
    if (parsedCot.thought) {
      const cardId = "cot-off-" + m.id;
      cotHtml = `
        <div class="offline-cot-toggle" onclick="window.toggleOfflineCotBody('${cardId}')" style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(0,0,0,0.03); border-radius:6px; font-size:11px; font-weight:700; color:#64748b; cursor:pointer; user-select:none; margin: 4px 0 8px 0;">
          <div style="display:flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
            <span>心理活动 (点击展开/折叠)</span>
          </div>
          <svg id="${cardId}-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition: transform 0.2s ease;"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div id="${cardId}-body" style="display:none; font-size:11px; color:#475569; background:rgba(0,0,0,0.02); border-left:2.5px solid var(--primary); padding:8px 10px; border-radius:4px; margin-bottom:8px; line-height:1.5; white-space:pre-wrap; word-break:break-all; text-align:justify;">
          ${escapeHtml(parsedCot.thought)}
        </div>
      `;
    }

    const displayContent = parsedCot.cleanText;
    if (!displayContent && !parsedCot.thought) {
      continue;
    }

    card.innerHTML = `
      <div class="offline-select-checkbox" style="display: ${isOfflineMultiSelectMode ? 'flex' : 'none'};">
        <input type="checkbox" class="offline-msg-checkbox" data-msg-id="${m.id}" onchange="updateOfflineSelectedCount()">
      </div>
      <div class="offline-card-header">
        <span>${senderLabel}</span>
        <span>${timeStr}</span>
      </div>
      ${cotHtml}
      <div class="offline-card-body">
        ${escapeHtml(displayContent)}
        ${(m.translatedContent && m.showTranslation === 1) ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); font-size:12px; color:#0369a1; line-height:1.5;"><span style="font-weight:700; margin-right:4px;">[中文翻译]</span>${escapeHtml(m.translatedContent)}</div>` : ''}
      </div>
    `;
    fragment.appendChild(card);
  }

  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

// 绑定线下卡片专属双击操作菜单 (安全保护锁)
function initOfflineContextMenuHandlers() {
  if (isOfflineContextMenuInitialized) return;
  isOfflineContextMenuInitialized = true;

  const menu = document.getElementById("offline-bubble-context-menu");
  if (!menu) return;
  
  menu.onclick = (e) => {
    if (e.target === menu) {
      menu.style.display = "none";
    }
  };

  const btnOfflineCancel = document.getElementById("btn-offline-menu-cancel");
  if (btnOfflineCancel) {
    btnOfflineCancel.onclick = () => {
      menu.style.display = "none";
    };
  }

  const btnOfflineEdit = document.getElementById("btn-offline-menu-edit");
  if (btnOfflineEdit) {
    btnOfflineEdit.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.offline_messages.get(activeOfflineSelectedMsgId);
      if (!msg) return;
      openCustomEditModal(activeOfflineSelectedMsgId, msg.content, true);
    };
  }

  const btnOfflineTranslate = document.getElementById("btn-offline-menu-translate");
  if (btnOfflineTranslate) {
    btnOfflineTranslate.onclick = async () => {
      menu.style.display = "none";
      if (activeOfflineSelectedMsgId) {
        await translateChatMessage(activeOfflineSelectedMsgId, true);
      }
    };
  }

  const btnOfflineFav = document.getElementById("btn-offline-menu-favorite");
  if (btnOfflineFav) {
    btnOfflineFav.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.offline_messages.get(activeOfflineSelectedMsgId);
      if (!msg) return;
      await db.offline_messages.update(activeOfflineSelectedMsgId, { isFavorite: 1 });
      showCustomAlert("收入收藏室", "该段落卡片已成功收入收藏室。");
    };
  }

  const btnOfflineDeleteSingle = document.getElementById("btn-offline-menu-delete-single");
  if (btnOfflineDeleteSingle) {
    btnOfflineDeleteSingle.onclick = async () => {
      menu.style.display = "none";
      showCustomConfirm("确认删除", "确定要删除这条线下记录吗？此操作不可逆。", async () => {
        await db.offline_messages.delete(activeOfflineSelectedMsgId);
        renderOfflineMessages();
      });
    };
  }

  const btnOfflineMulti = document.getElementById("btn-offline-menu-multi");
  if (btnOfflineMulti) {
    btnOfflineMulti.onclick = () => {
      menu.style.display = "none";
      enterOfflineMultiSelectMode();
    };
  }

  const btnOfflineReroll = document.getElementById("btn-offline-menu-reroll");
  if (btnOfflineReroll) {
    btnOfflineReroll.onclick = async () => {
      menu.style.display = "none";
      const msg = await db.offline_messages.get(activeOfflineSelectedMsgId);
      if (!msg) return;

      let targetUserMsg = null;
      let rawList = [];
      if (isOfflineTheater) {
        rawList = await db.offline_messages.where('theaterId').equals(activeTheaterId).toArray();
      } else {
        rawList = await db.offline_messages.where('sessionId').equals(activeSessionId).and(m => m.isTheater === 0).toArray();
      }

      if (msg.senderType === 'user') {
        targetUserMsg = msg;
      } else {
        const history = rawList
          .filter(m => m.timestamp <= msg.timestamp)
          .sort((a, b) => a.timestamp - b.timestamp);
        
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].senderType === 'user') {
            targetUserMsg = history[i];
            break;
          }
        }
      }

      if (!targetUserMsg) {
        showCustomAlert("无法回溯", "未能在上下文中搜寻到我的发言。");
        return;
      }

      showCustomConfirm("回溯重回", "确定要回溯重回吗？\n\n此操作将擦除该发言之后（包括当前发言）的所有线下段落卡片并重新获取 AI 回复。", async () => {
        const toDelete = rawList.filter(m => m.timestamp > targetUserMsg.timestamp);
        for (let td of toDelete) {
          await db.offline_messages.delete(td.id);
        }
        await renderOfflineMessages();
        const offlineReplyBtn = document.getElementById("btn-offline-reply");
        if (offlineReplyBtn) offlineReplyBtn.click();
      });
    };
  }

  const btnOfflineMultiCancel = document.getElementById("btn-offline-multi-cancel");
  if (btnOfflineMultiCancel) {
    btnOfflineMultiCancel.onclick = exitOfflineMultiSelectMode;
  }

  const btnOfflineMultiTranslate = document.getElementById("btn-offline-multi-translate");
  if (btnOfflineMultiTranslate) {
    btnOfflineMultiTranslate.onclick = () => batchTranslateMessages(true);
  }

  const btnOfflineMultiDelete = document.getElementById("btn-offline-multi-delete");
  if (btnOfflineMultiDelete) {
    btnOfflineMultiDelete.onclick = async () => {
      const checked = document.querySelectorAll(".offline-msg-checkbox:checked");
      if (checked.length === 0) return;
      showCustomConfirm("批量删除", `确认要彻底删除这 ${checked.length} 条选中的线下记录吗？`, async () => {
        for (let chk of checked) {
          const id = Number(chk.getAttribute("data-msg-id"));
          await db.offline_messages.delete(id);
        }
        exitOfflineMultiSelectMode();
        renderOfflineMessages();
      });
    };
  }
}

function enterOfflineMultiSelectMode() {
  isOfflineMultiSelectMode = true;
  document.getElementById("offline-input-row").style.display = "none";
  document.getElementById("offline-multi-select-bar").style.display = "flex";
  document.getElementById("offline-selected-count").innerText = "0";
  document.getElementById("offline-messages-flow").classList.add("multi-selecting");
  
  document.querySelectorAll(".offline-select-checkbox").forEach(el => el.style.display = "flex");
}

function exitOfflineMultiSelectMode() {
  isOfflineMultiSelectMode = false;
  document.getElementById("offline-input-row").style.display = "flex";
  document.getElementById("offline-multi-select-bar").style.display = "none";
  document.getElementById("offline-messages-flow").classList.remove("multi-selecting");
  
  document.querySelectorAll(".offline-select-checkbox").forEach(el => {
    if (el) el.style.display = "none";
  });
}

function updateOfflineSelectedCount() {
  const count = document.querySelectorAll(".offline-msg-checkbox:checked").length;
  document.getElementById("offline-selected-count").innerText = count;
}

// 发送线下白描
async function sendOfflineMessage() {
  const textEl = document.getElementById("offline-input-text");
  if (!textEl) return;
  const content = textEl.value.trim();
  if (!content) return;

  const msg = {
    theaterId: isOfflineTheater ? activeTheaterId : 0,
    sessionId: activeSessionId,
    isTheater: isOfflineTheater ? 1 : 0,
    senderType: 'user',
    content,
    timestamp: Date.now()
  };
  await db.offline_messages.add(msg);
  textEl.value = "";
  
  // 发送后重置 textarea 为初始单行自适应高度，防止高度残留
  textEl.style.height = "auto";
  textEl.style.overflowY = "hidden";

  await renderOfflineMessages();
}

// AI 线下专属大模型白描输出
async function triggerOfflineReply() {
  const header = document.getElementById("offline-chat-title");
  const originalTitle = header.innerText;
  const btnOfflineReply = document.getElementById("btn-offline-reply");

  // 如果当前正在请求，点击按钮立即中断
  if (offlineAbortController) {
    offlineAbortController.abort();
    offlineAbortController = null;
    header.classList.remove("header-typing");
    header.innerText = originalTitle;
    if (btnOfflineReply) btnOfflineReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
    showToast("当前请求已终止");
    return;
  }

  header.classList.add("header-typing");
  if (btnOfflineReply) btnOfflineReply.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="#f87171"/></svg>';

  try {
    offlineAbortController = new AbortController();
    const presetId = localStorage.getItem("global_api_preset_id");
    if (!presetId) throw new Error("未配置全局默认 API，请前往‘系统设置 - API 协议设置’中配置！");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("所选的 API 预设可能已被删除，请重新配置！");

    let offlineMsgs = [];
        let carryMemory = false;
        let onlineSummaryPrompt = "";
        
        if (isOfflineTheater) {
          const theater = await db.theaters.get(Number(activeTheaterId));
          carryMemory = theater ? !!theater.carryMemory : false;
          offlineMsgs = await db.offline_messages.where('theaterId').equals(activeTheaterId).sortBy('timestamp');
        } else {
          carryMemory = true; // 赴约模式
          offlineMsgs = await db.offline_messages.where('sessionId').equals(activeSessionId).and(m => m.isTheater === 0).sortBy('timestamp');
        }

        // 核心隔离：若开启携带记忆，将线上微信聊天转化为独立 System 参考背景，绝不塞入对话轮次压制白描！
        if (carryMemory) {
          const recentOnlineMsgs = (await db.messages.where('sessionId').equals(activeSessionId).reverse().limit(10).toArray()).reverse();
          if (recentOnlineMsgs.length > 0) {
            let onlineText = "";
            const sess = await db.sessions.get(activeSessionId);
            const user = await db.archives.get(sess.userId);
            const char = await db.archives.get(sess.charId);
            const cName = sess.customCharName || char?.name || "对方";
            const uName = sess.customUserName || user?.name || "我";

            recentOnlineMsgs.forEach(om => {
              let cleanStr = om.content
                .replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "")
                .replace(/[\[【](QUOTE|引用)\s*:\s*\d+[\]】]\s*/gi, "")
                .replace(/【表情包：[^】]+】/g, "")
                .replace(/[\[【]MSG_ID\s*:\s*\d+[\]】]/gi, "").trim();
              if (cleanStr) {
                onlineText += `[${om.senderType === 'user' ? uName : cName}]: ${cleanStr}\n`;
              }
            });

            if (onlineText) {
              onlineSummaryPrompt = `【往期线上微信聊天背景参考（注意：这是过去在手机上的聊天记录，仅供了解近期话题与态度参考，当前已切换至线下真实场景！）：】\n${onlineText}\n`;
            }
          }
        }

        const systemPrompt = await buildOfflineSystemPrompt(activeSessionId, activeTheaterId, isOfflineTheater);
        const messagesToSend = [{ role: "system", content: systemPrompt + (onlineSummaryPrompt ? "\n\n" + onlineSummaryPrompt : "") }];

        // 仅取真正的线下白描对话轮次塞入历史，计算场景设定时间推演，彻底斩断微信格式污染
        const sessObj = await db.sessions.get(activeSessionId);
        const simNowOffline = getSimulatedNow(sessObj);
        const history = offlineMsgs.slice(-15);
        let prevTime = null;

        history.forEach(h => {
          if (prevTime !== null && h.timestamp) {
            const diffMin = Math.floor((h.timestamp - prevTime) / 60000);
            if (diffMin >= 15) {
              const simDate = getMessageDisplayDate(h, sessObj);
              const formattedSimTime = formatWeChatTime(simDate, simNowOffline);
              let gapLabel = diffMin < 60 ? `${diffMin} 分钟` : (diffMin < 1440 ? `${(diffMin / 60).toFixed(1)} 小时` : `${Math.floor(diffMin / 1440)} 天`);
              messagesToSend.push({ role: "system", content: `[场景提示：线下情节推进过去了 ${gapLabel}，当前场景时间演断至：${formattedSimTime}]` });
            }
          }
          prevTime = h.timestamp || prevTime;

          let displayContent = h.content;
          if (typeof displayContent === 'string') {
            displayContent = displayContent.replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "").trim();
          }

          if (displayContent) {
            messagesToSend.push({ role: h.senderType === 'user' ? 'user' : 'assistant', content: displayContent });
          }
        });

        // 核心注入：在历史对话最末尾注入线下白描格式重置隔离墙，确保 100% 顺从情景设定与当前白描
        let finalOfflineSystemPrompt = "【最高指令：线下场景小说白描强制规范】\n你们现在处于真实物理线下面对面场景！手机打字交流已完全结束。\n你接下来的回复必须且只能严格按照【情景设定】和【叙事视角】进行小说白描与神态动作描写！【绝对严禁】输出任何微信短句、引用 [QUOTE]、表情包【表情包：...】或 [MSG_ID] 标签！";

        // 读取线上对话详情中的"心声随动"与"翻译随动"开关状态，决定线下回复是否一并生成心声/翻译
        const offlineStatusAutoOn = !!(sessObj && sessObj.statusAutoToggle === 1);
        const offlineTranslateAutoOn = !!(sessObj && sessObj.translateAutoToggle === 1);

    const sess = await db.sessions.get(activeSessionId);
        const char = await db.archives.get(sess.charId);
        const charName = sess?.customCharName || char?.name || "对方";
        let offlineMyName = "我";
        if (sess && sess.userId) {
          const userArch = await db.archives.get(sess.userId);
          if (userArch && userArch.name) offlineMyName = userArch.name;
        }

        // 心声随动：基于线下上下文生成，附加在白描之后
        if (offlineStatusAutoOn) {
          finalOfflineSystemPrompt += `\n\n【心声随动指令（重要）】
你需要在回复线下白描内容之后，额外输出当前角色（${charName}）对 ${offlineMyName} 此时此刻的真实内心状态。
请严格按照以下格式输出：

线下白描内容...

[STATUS]
{ "attire": "当前穿着描述", "affection": "好感度描述(0-100)", "excitement": "兴奋度/紧绷感描述", "thoughts": "此刻真实倾诉想法", "hiddenCorners": "心底隐秘想法/反差心声" }`;
        }

        // 翻译随动：附加在心声之后（若开启）
        if (offlineTranslateAutoOn) {
          finalOfflineSystemPrompt += `\n\n【翻译随动指令（重要）】
你需要在回复正常白描内容之后（如有心声则在心声之后），额外输出本次回复内容的中文翻译。
如果回复本身已是中文，则翻译为英文；如果回复包含非中文（如日语、英语、法语等），则翻译为简体中文。
请严格按照以下格式输出：

线下白描内容...

[TRANSLATE]
本次回复的完整翻译内容`;
        }

        messagesToSend.push({ role: "system", content: finalOfflineSystemPrompt });

        let streamingCard = null;
        const handleOfflineStreamChunk = (delta, currentFullText) => {
          const container = document.getElementById("offline-messages-flow");
          if (!container) return;

          if (!streamingCard) {
            streamingCard = document.createElement("div");
            streamingCard.className = "offline-card char streaming";
            container.appendChild(streamingCard);
          }

          const parsedCot = parseThoughtFromText(currentFullText, activeSessionId);
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // 关键修复：线下流式也必须遵守思维链开关，与线上 handleStreamChunk 保持一致
          // 关闭时即使推理模型原生输出 <think> 也不显示心理活动卡片
          const isOfflineCotEnabled = sessObj && sessObj.cotToggle === 1;

          let cotHtml = "";
          if (isOfflineCotEnabled && parsedCot.thought) {
            cotHtml = `
              <div class="offline-cot-toggle" onclick="window.toggleOfflineCotBody('cot-stream-off')" style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(0,0,0,0.03); border-radius:6px; font-size:11px; font-weight:700; color:#64748b; cursor:pointer; user-select:none; margin: 4px 0 8px 0;">
                <div style="display:flex; align-items:center; gap:4px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                  <span>心理活动 (思考中...)</span>
                </div>
                <svg id="cot-stream-off-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition: transform 0.2s ease; transform: rotate(180deg);"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div id="cot-stream-off-body" style="display:block; font-size:11px; color:#475569; background:rgba(0,0,0,0.02); border-left:2.5px solid var(--primary); padding:8px 10px; border-radius:4px; margin-bottom:8px; line-height:1.5; white-space:pre-wrap; word-break:break-all; text-align:justify;">
                ${escapeHtml(parsedCot.thought)}
              </div>
            `;
          }

          streamingCard.innerHTML = `
            <div class="offline-card-header">
              <span>${escapeHtml(charName)}</span>
              <span>${timeStr}</span>
            </div>
            ${cotHtml}
            <div class="offline-card-body">${escapeHtml(parsedCot.cleanText)}</div>
          `;

          container.scrollTop = container.scrollHeight;
        };

        let rawReply = await fetchStreamOrJson(api.url, api, messagesToSend, offlineAbortController.signal, handleOfflineStreamChunk);

        if (streamingCard) {
          streamingCard.remove();
          streamingCard = null;
        }

        rawReply = rawReply.trim();
        if (!rawReply) return;

        // 核心关停：校验当前 Session 思维链开关，若为关闭状态 (cotToggle !== 1)，直接擦除 <think> 标签，只保留纯净白描
        const isCotEnabled = sessObj && sessObj.cotToggle === 1;
        if (!isCotEnabled) {
          const parsedCot = parseThoughtFromText(rawReply, activeSessionId);
          rawReply = parsedCot.cleanText;
        }

        if (!rawReply) return;

        // === 离线剧场模式：擦除 PLAY_MUSIC 放歌指令，避免污染对话气泡 ===
        const playMusicRegexOffline = /[\[【](PLAY_MUSIC|播放音乐|MCP_PLAY_MUSIC)[\]】]\s*(\{[\s\S]*?\})/i;
        const playMusicMatchOffline = rawReply.match(playMusicRegexOffline);
        if (playMusicMatchOffline) {
          try {
            const parsed = JSON.parse(playMusicMatchOffline[2]);
            const targetIndex = parseInt(parsed.index);
            if (!isNaN(targetIndex) && window.mcpSystem && typeof window.mcpSystem.playTrackByIndex === 'function') {
              window.mcpSystem.playTrackByIndex(targetIndex);
            } else if (parsed.title && window.mcpSystem && typeof window.mcpSystem.playTrackByTitle === 'function') {
              window.mcpSystem.playTrackByTitle(parsed.title);
            }
          } catch(e) {
            console.warn("解析 AI 自动放歌指令 JSON 失败:", e);
          }
          rawReply = rawReply.replace(playMusicRegexOffline, "").trim();
        }

        // === 离线剧场模式：解析并擦除 SET_ALARM 设闹钟指令（容错版）===
        const setAlarmRegexOffline = /[\[【](SET_ALARM|设闹钟|设定闹钟|MCP_SET_ALARM)[\]】]\s*(\{[\s\S]*?\})/i;
        const setAlarmMatchOffline = rawReply.match(setAlarmRegexOffline);
        if (setAlarmMatchOffline) {
          if (window.mcpSystem && typeof window.mcpSystem.setAlarmFromRawJson === 'function') {
            window.mcpSystem.setAlarmFromRawJson(setAlarmMatchOffline[2]);
          }
          rawReply = rawReply.replace(setAlarmRegexOffline, "").trim();
        }

        // 解析线下心声随动 [STATUS]（用括号平衡法提取完整 JSON）
        let offlineStatusJson = null;
        if (offlineStatusAutoOn) {
          const statusIdx = rawReply.indexOf('[STATUS]');
          if (statusIdx !== -1) {
            const afterStatus = rawReply.substring(statusIdx + 8);
            const balancedJson = extractBalancedJson(afterStatus);
            if (balancedJson) {
              try {
                offlineStatusJson = JSON.parse(balancedJson);
                rawReply = rawReply.substring(0, statusIdx).trim();
                // 保存线下心声到 status_history（线下：isTheater=1 或 0 取决于模式）
                try {
                  const userRegex = /\buser\b/gi;
                  const cleanProp = (val) => (typeof val === 'string') ? val.replace(userRegex, offlineMyName) : val;
                  await db.status_history.add({
                    sessionId: activeSessionId,
                    theaterId: isOfflineTheater ? activeTheaterId : 0,
                    isTheater: isOfflineTheater ? 1 : 0,
                    timestamp: Date.now(),
                    attire: cleanProp(offlineStatusJson.attire) || '未详',
                    affection: cleanProp(offlineStatusJson.affection) || '未详',
                    excitement: cleanProp(offlineStatusJson.excitement) || '未详',
                    thoughts: cleanProp(offlineStatusJson.thoughts) || '未详',
                    hiddenCorners: cleanProp(offlineStatusJson.hiddenCorners) || '无'
                  });
                } catch (saveErr) { console.warn('保存线下心声历史失败:', saveErr); }
              } catch (e) { console.warn("解析线下心声 JSON 失败:", e); }
            }
          }
        }

        // 解析线下翻译随动 [TRANSLATE]
        let offlineTranslationText = null;
        if (offlineTranslateAutoOn) {
          const translateIdx = rawReply.indexOf('[TRANSLATE]');
          if (translateIdx !== -1) {
            offlineTranslationText = rawReply.substring(translateIdx + 11).trim();
            rawReply = rawReply.substring(0, translateIdx).trim();
          }
        }

        if (!rawReply) return;

        const msg = {
          theaterId: isOfflineTheater ? activeTheaterId : 0,
          sessionId: activeSessionId,
          isTheater: isOfflineTheater ? 1 : 0,
          senderType: 'char',
          content: rawReply,
          timestamp: Date.now()
        };
        if (offlineTranslationText) {
          msg.translatedContent = offlineTranslationText;
          msg.showTranslation = 1;
        }
        await db.offline_messages.add(msg);
        await renderOfflineMessages();

  } catch (err) {
    if (err.name === 'AbortError') {
      // 默默忽略，由上面统一处理
      return;
    }
    console.error(err);
    showCustomAlert("API 发生错误", err.message);
  } finally {
    header.classList.remove("header-typing");
    header.innerText = originalTitle;
    if (btnOfflineReply) btnOfflineReply.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>';
    offlineAbortController = null;
  }
}

// 线下场景设置面板逻辑 (支持 POV 参数装载)
async function openOfflineDetails() {
  const sess = await db.sessions.get(activeSessionId);
  if (isOfflineTheater) {
    const th = await db.theaters.get(activeTheaterId);
    document.getElementById("offline-detail-min-word").value = th.minWordCount || 50;
    document.getElementById("offline-detail-max-word").value = th.maxWordCount || 300;
    // 自动总结轮数默认继承线上设置
    document.getElementById("offline-detail-auto-summary").value = sess.autoSummaryInterval || 10; 
    document.getElementById("offline-detail-char-pov").value = th.charPOV || "第三人称";
    document.getElementById("offline-detail-user-pov").value = th.userPOV || "第二人称";
    document.getElementById("btn-end-appointment").style.display = "none";
  } else {
    // 赴约模式
    document.getElementById("offline-detail-min-word").value = sess.offlineMinWordCount || 50;
    document.getElementById("offline-detail-max-word").value = sess.offlineMaxWordCount || 200;
    // 自动总结轮数默认继承线上设置
    document.getElementById("offline-detail-auto-summary").value = sess.autoSummaryInterval || sess.offlineAutoSummaryCount || 10;
    document.getElementById("offline-detail-char-pov").value = sess.offlineCharPOV || "第三人称";
    document.getElementById("offline-detail-user-pov").value = sess.offlineUserPOV || "第二人称";
    document.getElementById("btn-end-appointment").style.display = "block";
  }

  // 渲染线下专属世界书手风琴选择器
  const containerEl = document.getElementById("offline-details-wb-mounted-accordion");
  if (containerEl && typeof renderWbMountedAccordion === 'function') {
    const currentMounted = isOfflineTheater ? (sess.mountedEntryIds || []) : (sess.offlineMountedEntryIds || sess.mountedEntryIds || []);
    await renderWbMountedAccordion(containerEl, currentMounted, "cb-offline-details-wb-mount");
  }

  document.getElementById("win-offline-details").classList.add("active");
}

function closeOfflineDetails() {
  document.getElementById("win-offline-details").classList.remove("active");
}

async function saveOfflineDetails() {
  const minWord = Number(document.getElementById("offline-detail-min-word").value) || 50;
  const maxWord = Number(document.getElementById("offline-detail-max-word").value) || 200;
  const autoSummary = Number(document.getElementById("offline-detail-auto-summary").value) || 10;
  const charPOV = document.getElementById("offline-detail-char-pov").value;
  const userPOV = document.getElementById("offline-detail-user-pov").value;

  // 抓取线下手风琴选择器选中的世界书条目 ID 列表
  const checkedBoxes = document.querySelectorAll(".cb-offline-details-wb-mount:checked");
  const mountedEntryIds = Array.from(checkedBoxes).map(cb => Number(cb.value));

  if (isOfflineTheater) {
    await db.theaters.update(activeTheaterId, {
      minWordCount: minWord,
      maxWordCount: maxWord,
      charPOV,
      userPOV
    });
  } else {
    // 赴约模式
    await db.sessions.update(activeSessionId, {
      offlineMinWordCount: minWord,
      offlineMaxWordCount: maxWord,
      autoSummaryInterval: autoSummary, // 默认回写继承至线上自动总结区间配置
      offlineAutoSummaryCount: autoSummary,
      offlineMountedEntryIds: mountedEntryIds,
      offlineCharPOV: charPOV,
      offlineUserPOV: userPOV
    });
  }

  alert("线下场景配置已成功保存！");
  closeOfflineDetails();
}

// 高自愈格式化多维度文本标签或 JSON 块解析提取器
function parseClassificationText(rawText, formatChoice) {
  let items = [];
  if (formatChoice === "json") {
    try {
      let cleaned = rawText.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
      try {
        items = JSON.parse(cleaned);
      } catch (err) {
        cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
        if (!cleaned.startsWith('[') && cleaned.includes('{')) cleaned = '[' + cleaned;
        if (!cleaned.endsWith(']') && cleaned.includes('}')) cleaned = cleaned + ']';
        items = JSON.parse(cleaned);
      }
    } catch (e) {
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
      } catch (regexErr) {}
    }
  } else {
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
    } catch (textErr) {}
  }
  if (!Array.isArray(items) || items.length === 0) {
    items = [{ category: 'factual', content: rawText, keywords: ["线下约会", "见面回顾"] }];
  }
  return items;
}

// 结束赴约模式 (赴约模式专属记忆回写与长效记忆库存储同步)
async function endAppointment() {
  showCustomConfirm("结束赴约", "确定要结束当前的线下赴约吗？\n\n系统将自动根据当前的总结系统提示词与分类协议进行多维度总结，并无缝注入角色心智，成为后续长效记忆的一部分。", async () => {
    const header = document.getElementById("offline-chat-title");
    header.classList.add("header-typing");
    header.innerText = "正在多维总结中...";

    try {
      const presetId = localStorage.getItem("global_api_preset_id");
      const api = await db.api_presets.get(Number(presetId));
      if (!api) throw new Error("无法加载全局 API 预设，无法同步记忆。");

      const msgs = await db.offline_messages
        .where('sessionId').equals(activeSessionId)
        .and(m => m.isTheater === 0)
        .sortBy('timestamp');

      if (msgs.length === 0) {
        showCustomAlert("无可总结数据", "暂无对话数据，无需总结记忆。");
        return;
      }

      let dialogText = "";
      const sess = await db.sessions.get(activeSessionId);
      const char = await db.archives.get(sess.charId);
      const user = await db.archives.get(sess.userId);
      const charName = sess.customCharName || char?.name || "对方";
      const userName = sess.customUserName || user?.name || "我";

      msgs.forEach(m => {
        const sender = m.senderType === 'user' ? userName : charName;
        dialogText += `[${sender}]: ${m.content}\n`;
      });

      const formatChoice = localStorage.getItem("summary-format-choice") || "json";
      let systemPrompt = "";

      if (formatChoice === "json") {
        systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的线下对话/白描轮次进行碎片化总结，并严格归入以下三个模块分类：
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
线下对话原文：
${dialogText}`;
      } else {
        systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的线下对话/白描轮次进行碎片化总结，并严格归入以下三个模块分类（如果没有对应分类内容可省略该块）。请直接按照以下文字标签块格式输出（不要包含 Markdown 代码块）：

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
线下对话原文：
${dialogText}`;
      }

      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [{ role: "user", content: systemPrompt }],
          temperature: 0.3
        })
      });

      if (!response.ok) throw new Error("API 总结调用失败");

      const result = await response.json();
      const rawSummaryText = result.choices[0].message.content.trim();

      // 解析生成碎片集合
      const items = parseClassificationText(rawSummaryText, formatChoice);

      // 1. 无缝回写长期角色记忆
      const currentPersona = sess.customCharPersona || char?.persona || "";
      let summariesMemo = "";
      items.forEach(item => {
        summariesMemo += `\n- [线下经历-${item.category}]: ${item.content}`;
      });
      const updatedPersona = `${currentPersona}\n\n【线下共同经历多维记忆（结束赴约时同步注入）：${summariesMemo}\n】`;

      await db.sessions.update(activeSessionId, {
        customCharPersona: updatedPersona
      });

      // 2. 存储原始只读消息数据作为存档
      const archiveMsgData = msgs.map(m => ({
        senderType: m.senderType,
        content: m.content,
        timestamp: m.timestamp
      }));

      // 按时间戳进行归档对齐
      const summaryTimestamp = Date.now();
      const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";

      for (let item of items) {
        let vector = null;
        if (isVectorEnabled) {
          vector = await safeGetEmbedding(item.content);
        }

        await db.summaries.add({
          sessionId: activeSessionId,
          startRound: 1,
          endRound: msgs.length,
          content: item.content,
          category: item.category,
          keywords: JSON.stringify(item.keywords || []),
          timestamp: summaryTimestamp,
          source: 'appointment_archive',
          rawMessages: JSON.stringify(archiveMsgData),
          vector: vector
        });
      }

      await db.offline_messages
        .where('sessionId').equals(activeSessionId)
        .and(m => m.isTheater === 0)
        .delete();

      showCustomAlert("记忆同步成功", "赴约已圆满结束！多维经历记忆已经同步注入心智，原对白也已成功录入历史回顾舱。");
      
      closeOfflineDetails();
      exitOfflineChat();

    } catch (err) {
      console.error(err);
      showCustomAlert("同步失败", "总结约会经历失败: " + err.message);
    } finally {
      header.classList.remove("header-typing");
      header.innerText = "线下见面";
    }
  });
}

// === 历史赴约存档选择与只读回顾业务功能 ===
async function openAppointmentArchives() {
  const archiveWin = document.getElementById("win-appointment-archive");
  if (archiveWin) {
    // 同步清空历史存档列表，根治读取时的列表闪动
    const container = document.getElementById("appointment-archive-list");
    if (container) container.innerHTML = "";

    archiveWin.classList.add("active");
    await renderAppointmentArchives();
  }
}

async function renderAppointmentArchives() {
  const container = document.getElementById("appointment-archive-list");
  if (!container) return;
  container.innerHTML = "";

  if (!activeSessionId) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">当前无活跃会话</p>`;
    return;
  }

  const list = await db.summaries
    .where('sessionId').equals(activeSessionId)
    .and(s => s.source === 'appointment_archive')
    .toArray();

  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">当前会话尚未产生任何历史赴约存盘</p>`;
    return;
  }

  // 根据共享时间戳将分散的分类记忆片重新聚合归档
  const grouped = {};
  list.forEach(arc => {
    const key = arc.timestamp;
    if (!grouped[key]) {
      grouped[key] = {
        timestamp: arc.timestamp,
        rawMessages: arc.rawMessages,
        categories: []
      };
    }
    grouped[key].categories.push(arc);
  });

  const sortedKeys = Object.keys(grouped).sort((a, b) => b - a);

  sortedKeys.forEach(key => {
    const g = grouped[key];
    const card = document.createElement("div");
    card.className = "archive-card";
    card.style.cssText = "background: #ffffff; border: 1.5px solid var(--border); border-radius: 12px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow-sm); margin-bottom:2px;";
    
    const timeStr = new Date(Number(g.timestamp)).toLocaleString();
    
    // 合并展示前 2 条记忆片做为列表摘要
    let summarySummary = "";
    g.categories.slice(0, 2).forEach(c => {
      const catMap = { 'emotional': '情感', 'factual': '事实', 'core': '核心' };
      summarySummary += `[${catMap[c.category] || '事实'}] ${c.content} `;
    });

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px dashed var(--border); padding-bottom: 6px;">
        <span style="font-size: 11px; color: var(--text-secondary); font-weight:700;">赴约时间：${timeStr}</span>
        <span style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight:700;">只读 Review</span>
      </div>
      <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5; font-weight: 500; text-align: justify; word-break: break-all;">
        ${escapeHtml(summarySummary)} ${g.categories.length > 2 ? '...' : ''}
      </div>
    `;
    card.onclick = () => openArchiveDetail(g.timestamp);
    container.appendChild(card);
  });
}

async function openArchiveDetail(timestampKey) {
  const list = await db.summaries
    .where('sessionId').equals(activeSessionId)
    .and(s => s.timestamp === Number(timestampKey))
    .toArray();

  if (list.length === 0) return;
  const masterArc = list[0];

  const detailWin = document.getElementById("win-appointment-archive-detail");
  const summaryBox = document.getElementById("archive-detail-summary-box");
  const flowBox = document.getElementById("archive-detail-messages-flow");

  if (!detailWin || !summaryBox || !flowBox) return;

  // 渲染多维分类侧边指示彩色气泡
  summaryBox.innerHTML = "";
  list.forEach(item => {
    const catMap = { 'emotional': '情感需求', 'factual': '事实记忆', 'core': '核心记忆' };
    const catColor = item.category === 'emotional' ? '#ec4899' : (item.category === 'core' ? '#ca8a04' : '#10b981');
    const div = document.createElement("div");
    div.style.cssText = `margin-bottom: 8px; border-left: 3px solid ${catColor}; padding-left: 8px; font-size:12.5px; line-height: 1.5; text-align: justify;`;
    div.innerHTML = `<span style="font-weight:700; color:${catColor};">[${catMap[item.category] || '事实'}]</span> ${escapeHtml(item.content)}`;
    summaryBox.appendChild(div);
  });

  // 渲染对白（只读模式）
  flowBox.innerHTML = "";
  let rawMsgs = [];
  try {
    rawMsgs = JSON.parse(masterArc.rawMessages || "[]");
  } catch(e) {
    console.error(e);
  }

  if (rawMsgs.length === 0) {
    flowBox.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:12px;padding:20px 0;">该存盘中未捕获任何具体发言细节</p>`;
  } else {
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const user = await db.archives.get(sess.userId);
    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || user?.name || "我";

    const fragment = document.createDocumentFragment();
    rawMsgs.forEach(m => {
      const card = document.createElement("div");
      card.className = `offline-card ${m.senderType === 'user' ? 'user' : 'char'}`;
      const senderLabel = m.senderType === 'user' ? userName : charName;
      const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      card.innerHTML = `
        <div class="offline-card-header">
          <span>${senderLabel}</span>
          <span>${timeStr}</span>
        </div>
        <div class="offline-card-body">${escapeHtml(m.content)}</div>
      `;
      fragment.appendChild(card);
    });
    flowBox.appendChild(fragment);
  }

  // 绑定重新总结
  const reSumBtn = document.getElementById("btn-re-summarize-archive");
  if (reSumBtn) {
    reSumBtn.onclick = async () => {
      reSumBtn.disabled = true;
      summaryBox.innerHTML = "<div style='font-size:12px; color:var(--text-secondary);'>正在重新多维分析并提炼存档记忆中...</div>";
      try {
        await regenerateArchiveSummary(timestampKey);
        await openArchiveDetail(timestampKey); // 重新加载视图
        await renderAppointmentArchives(); // 刷新父列表摘要
        showToast("多维总结重新提炼成功，并已完成对齐重写！");
      } catch(err) {
        console.error(err);
        showCustomAlert("重新提炼失败", err.message);
      } finally {
        reSumBtn.disabled = false;
      }
    };
  }

  detailWin.classList.add("active");
}

async function regenerateArchiveSummary(timestampKey) {
  const list = await db.summaries
    .where('sessionId').equals(activeSessionId)
    .and(s => s.timestamp === Number(timestampKey))
    .toArray();

  if (list.length === 0) throw new Error("未找到对应时间戳的记忆碎片");
  const masterArc = list[0];
  if (!masterArc.rawMessages) throw new Error("该存盘对白已损坏，无法重新提炼");

  const presetId = localStorage.getItem("global_api_preset_id");
  const api = await db.api_presets.get(Number(presetId));
  if (!api) throw new Error("未配置全局默认 API，请前往‘系统设置’中配置！");

  const sess = await db.sessions.get(activeSessionId);
  const char = await db.archives.get(sess.charId);
  const user = await db.archives.get(sess.userId);
  const charName = sess.customCharName || char?.name || "对方";
  const userName = sess.customUserName || user?.name || "我";

  let dialogText = "";
  const rawMsgs = JSON.parse(masterArc.rawMessages);
  rawMsgs.forEach(m => {
    const sender = m.senderType === 'user' ? userName : charName;
    dialogText += `[${sender}]: ${m.content}\n`;
  });

  const formatChoice = localStorage.getItem("summary-format-choice") || "json";
  let systemPrompt = "";

  if (formatChoice === "json") {
    systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的线下对话/白描轮次进行碎片化总结，并严格归入以下三个模块分类：
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
线下对话原文：
${dialogText}`;
  } else {
    systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的线下对话/白描轮次进行碎片化总结，并严格归入以下三个模块分类（如果没有对应分类内容可省略该块）。请直接按照以下文字标签块格式输出（不要包含 Markdown 代码块）：

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
线下对话原文：
${dialogText}`;
  }

  const response = await fetch(`${api.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
    body: JSON.stringify({
      model: api.model,
      messages: [{ role: "user", content: systemPrompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) throw new Error("API 总结调用失败");

  const result = await response.json();
  const rawSummaryText = result.choices[0].message.content.trim();

  const items = parseClassificationText(rawSummaryText, formatChoice);

  // 清理老旧碎片的同一时间戳对齐记录
  for (let s of list) {
    await db.summaries.delete(s.id);
  }

  // 写入新生成的碎片
  const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  for (let item of items) {
    let vector = null;
    if (isVectorEnabled) {
      vector = await safeGetEmbedding(item.content);
    }

    await db.summaries.add({
      sessionId: activeSessionId,
      startRound: 1,
      endRound: rawMsgs.length,
      content: item.content,
      category: item.category,
      keywords: JSON.stringify(item.keywords || []),
      timestamp: Number(timestampKey),
      source: 'appointment_archive',
      rawMessages: masterArc.rawMessages,
      vector: vector
    });
  }
}

// 安全收拢事件监听注册，防范 DOM null 崩溃并在生命周期内强制单次绑定限制 [1]
function bindOfflineChatAppEvents() {
  if (isOfflineChatAppEventsBound) return;
  isOfflineChatAppEventsBound = true;

  const btnOfflineSend = document.getElementById("btn-offline-send");
  if (btnOfflineSend) btnOfflineSend.onclick = sendOfflineMessage;

  const btnOfflineReply = document.getElementById("btn-offline-reply");
  if (btnOfflineReply) btnOfflineReply.onclick = triggerOfflineReply;

  const btnSaveOfflineDetails = document.getElementById("btn-save-offline-details");
  if (btnSaveOfflineDetails) btnSaveOfflineDetails.onclick = saveOfflineDetails;

  const btnEndAppointment = document.getElementById("btn-end-appointment");
  if (btnEndAppointment) btnEndAppointment.onclick = endAppointment;

  // 绑定线下输入框动态换行自适应增高监听 (最多4行，即 90px) [1]
  const textarea = document.getElementById("offline-input-text");
  if (textarea) {
    textarea.addEventListener("input", function() {
      this.style.height = "auto";
      const sHeight = this.scrollHeight;
      const maxH = 90; // 4行物理行高像素对齐线
      if (sHeight > maxH) {
        this.style.height = maxH + "px";
        this.style.overflowY = "auto";
      } else {
        this.style.height = sHeight + "px";
        this.style.overflowY = "hidden";
      }
    });
  }
}

// 全局三态解耦加号展开栏调度管理器，精准服务于单聊（14项）、群聊成员（13项）与群聊旁白（2项）多模态场景 [3]
window.setupExpandPanel = function(mode) {
  const panel = document.getElementById("chat-expand-panel");
  if (!panel) return;

  const page1 = panel.querySelector(".expand-slider .expand-page:nth-child(1)");
  const page2 = panel.querySelector(".expand-slider .expand-page:nth-child(2)");
  const dots = panel.querySelector(".expand-dots");

  // 召回所有 18 项 SVG 物理功能按键
  const btnSticker = document.getElementById("btn-chat-sticker");
  const btnPhoto = document.getElementById("btn-chat-photo");
  const btnVoice = document.getElementById("btn-chat-voice-trigger");
  const btnCall = document.getElementById("btn-chat-call");
  const btnTransfer = document.getElementById("btn-chat-transfer");
  const btnRedEnvelope = document.getElementById("btn-chat-redenvelope");
  const btnLocation = document.getElementById("btn-chat-location");
  const btnFocus = document.getElementById("btn-chat-focus");
  const btnOffline = document.getElementById("btn-chat-offline");
  const btnCheckPhone = document.getElementById("btn-chat-check-phone");
  const btnMemory = document.getElementById("btn-chat-memory");
  const btnSummary = document.getElementById("btn-chat-summary");
  const btnHtml = document.getElementById("btn-chat-html-widget");
  const btnPlot = document.getElementById("btn-chat-plot-engine");
  const btnMcp = document.getElementById("btn-chat-mcp");
  const btnCot = document.getElementById("btn-chat-cot");
  const btnPoll = document.getElementById("btn-chat-group-poll");
  const btnHelper = document.getElementById("btn-chat-group-helper");
  const btnAnnounce = document.getElementById("btn-chat-group-announce");
  const btnMembers = document.getElementById("btn-chat-group-members");

  const allItems = [
    btnSticker, btnPhoto, btnVoice, btnCall, btnTransfer, btnRedEnvelope, btnLocation,
    btnFocus, btnOffline, btnCheckPhone, btnMemory, btnSummary, btnHtml,
    btnPlot, btnMcp, btnCot, btnPoll, btnHelper, btnAnnounce, btnMembers
  ];
  allItems.forEach(item => {
    if (item) item.style.display = "none";
  });

  if (mode === 'single') {
    // 1. 单聊专属：第1页装载 8 项，第2页装载 7 项（位置移至第2页），合计 15 项原生按键
    if (page1) {
      page1.appendChild(btnSticker);
      page1.appendChild(btnPhoto);
      page1.appendChild(btnVoice);
      page1.appendChild(btnCall);
      page1.appendChild(btnTransfer);
      page1.appendChild(btnRedEnvelope);
      page1.appendChild(btnFocus);
      page1.appendChild(btnOffline);
    }
    if (page2) {
      page2.appendChild(btnLocation);
      page2.appendChild(btnCheckPhone);
      page2.appendChild(btnMemory);
      page2.appendChild(btnSummary);
      page2.appendChild(btnHtml);
      page2.appendChild(btnPlot);
      page2.appendChild(btnMcp);
      page2.appendChild(btnCot);
    }
    const activeItems = [
      btnSticker, btnPhoto, btnVoice, btnCall, btnTransfer, btnRedEnvelope, btnLocation,
      btnFocus, btnOffline, btnCheckPhone, btnMemory, btnSummary, btnHtml,
      btnPlot, btnMcp, btnCot
    ];
    activeItems.forEach(item => { if (item) item.style.display = "flex"; });
    if (page1) page1.style.display = "grid";
    if (page2) page2.style.display = "grid";
    if (dots) dots.style.display = "flex";

  } else if (mode === 'group') {
    // 2. 群聊成员专属：第1页装载 8 项，第2页装载 5 项，合计 13 项群组按键
    if (page1) {
      page1.appendChild(btnSticker);
      page1.appendChild(btnPhoto);
      page1.appendChild(btnVoice);
      page1.appendChild(btnTransfer);
      page1.appendChild(btnRedEnvelope);
      page1.appendChild(btnLocation);
      page1.appendChild(btnOffline);
      page1.appendChild(btnPlot);
      page1.appendChild(btnPoll);
    }
    if (page2) {
      page2.appendChild(btnHelper);
      page2.appendChild(btnAnnounce);
      page2.appendChild(btnMemory);
      page2.appendChild(btnSummary);
      page2.appendChild(btnMembers);
      page2.appendChild(btnCot);
    }
    const activeItems = [
      btnSticker, btnPhoto, btnVoice, btnTransfer, btnRedEnvelope, btnLocation, btnOffline,
      btnPlot, btnPoll, btnHelper, btnAnnounce, btnMemory, btnSummary, btnMembers, btnCot
    ];
    activeItems.forEach(item => { if (item) item.style.display = "flex"; });
    if (page1) page1.style.display = "grid";
    if (page2) page2.style.display = "grid";
    if (dots) dots.style.display = "flex";

  } else if (mode === 'narrator') {
    // 3. 群聊上帝旁白专属：保留记忆、总结与思维链
    if (page1) {
      page1.appendChild(btnMemory);
      page1.appendChild(btnSummary);
      page1.appendChild(btnCot);
    }
    const activeItems = [btnMemory, btnSummary, btnCot];
    activeItems.forEach(item => { if (item) item.style.display = "flex"; });
    if (page1) page1.style.display = "grid";
    if (page2) page2.style.display = "none";
    if (dots) dots.style.display = "none";
  }
};

// 微信语音以及自定义图片发设绑定 (核心去原生 Prompt)
function bindMultimediaEvents() {
  // 1. 语音发送交互
  const btnVoiceTrigger = document.getElementById("btn-chat-voice-trigger");
  if (btnVoiceTrigger) {
    btnVoiceTrigger.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      document.getElementById("voice-input-overlay").classList.add("active");
    };
  }

  const btnLocation = document.getElementById("btn-chat-location");
  if (btnLocation) {
    btnLocation.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      showCustomPrompt("发送位置 - 位置名称", "", (name) => {
        if (!name.trim()) return;
        showCustomPrompt("经纬度（可选，留空则随机生成）", "", (coord) => {
          let finalCoord = coord.trim();
          if (!finalCoord) {
            // 留空则在中国大陆范围内随机生成经纬度
            const lat = (Math.random() * (53.55 - 18.0) + 18.0).toFixed(6);
            const lng = (Math.random() * (135.08 - 73.66) + 73.66).toFixed(6);
            finalCoord = `${lat},${lng}`;
          }
          const locData = JSON.stringify({ name: name.trim(), coord: finalCoord });
          const sid = activeSessionId;
          if (!sid) return;
          db.messages.add({
            sessionId: sid,
            senderType: 'user',
            senderId: Number(localStorage.getItem("active_me_id") || 0),
            content: locData,
            contentType: 'location',
            timestamp: Date.now()
          }).then(msgId => {
            if (typeof appendMessageToDOM === 'function') {
              db.messages.get(msgId).then(msg => { if (msg) appendMessageToDOM(msg); });
            }
          });
        });
      });
    };
  }

  const btnVoiceSubmit = document.getElementById("btn-voice-submit");
  if (btnVoiceSubmit) {
    btnVoiceSubmit.onclick = async () => {
      const duration = parseInt(document.getElementById("voice-duration-slider").value) || 5;
      const text = document.getElementById("voice-input-text").value.trim();
      
      if (!text) {
        alert("请输入语音转写内容文本（用于 AI 识别感知）！");
        return;
      }

      const voiceData = {
        duration: duration,
        text: text
      };

      await saveAndRenderMessage('user', JSON.stringify(voiceData), 'voice');
      
      // 重置并清理
      document.getElementById("voice-input-text").value = "";
      document.getElementById("voice-duration-slider").value = 5;
      document.getElementById("voice-duration-val").innerText = "5";
      document.getElementById("voice-input-overlay").classList.remove("active");
    };
  }

  // 2. 自定义图片伴随说明发送交互
  const btnPhotoTrigger = document.getElementById("btn-chat-photo");
  if (btnPhotoTrigger) {
    btnPhotoTrigger.onclick = () => {
      document.getElementById("chat-expand-panel").classList.remove("active");
      document.getElementById("image-input-overlay").classList.add("active");
    };
  }

  const btnImageSubmit = document.getElementById("btn-image-submit");
  if (btnImageSubmit) {
    btnImageSubmit.onclick = async () => {
      const fileInput = document.getElementById("image-file-input");
      const captionText = document.getElementById("image-input-text").value.trim();

      if (!captionText) {
        alert("为了让 AI 伙伴能看懂您的图片意图，请务必填写具体的画面场景描述！");
        return;
      }

      const processAndSend = async (imgUrl) => {
        const imgData = {
          url: imgUrl, // 如果用户实际上传了图片，imgUrl 为 Base64 Data URL；如果没有上传，则是空字符串
          text: captionText
        };
        await saveAndRenderMessage('user', JSON.stringify(imgData), 'image');
        
        // 重置清理
        if (fileInput) fileInput.value = "";
        const label = document.getElementById("image-file-name-label");
        if (label) label.innerText = "未选择文件";
        document.getElementById("image-input-text").value = "";
        document.getElementById("image-input-overlay").classList.remove("active");
      };

      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          await processAndSend(e.target.result);
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        // 如果未上传物理图片，URL 属性直接设为空，安全依赖全新的灰色卡片进行干净渲染
        await processAndSend("");
      }
    };
  }
}

// 提取纯文本辅助器（自动智能剥离 [QUOTE:ID] 引用标签与思维链 <think>，并解析语音与图片 JSON 真正台词）
function extractBareTextForTranslation(msg) {
  if (!msg || !msg.content) return "";
  let raw = msg.content;
  if (msg.contentType === 'voice' || msg.contentType === 'image') {
    try {
      const data = JSON.parse(raw);
      raw = data.text || data.voiceText || data.imageText || raw;
    } catch(e) {}
  }
  if (typeof raw === 'string') {
    // 物理剥离首部的 [QUOTE:消息ID] 或 【QUOTE:消息ID】 引用标签，防止引用标记被误送去翻译
    raw = raw.replace(/^[\[【](QUOTE|引用)\s*:\s*\d+[\]】]\s*/i, '').trim();
    // 物理剥离旧思维链（覆盖所有标签变体 + 未闭合兜底）
    raw = raw.replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "").trim();
  }
  return raw;
}

// 微信同款按需翻译引擎（支持文本、语音、图片智能解包与落盘）
async function translateChatMessage(msgId, isOffline = false) {
  const table = isOffline ? db.offline_messages : db.messages;
  const msg = await table.get(Number(msgId));
  if (!msg) return;

  // 1. 如果已经翻译过，切换翻译文本的显示/隐藏状态
  if (msg.translatedContent) {
    const isShowing = msg.showTranslation === 1;
    await table.update(Number(msgId), { showTranslation: isShowing ? 0 : 1 });
    if (isOffline) await renderOfflineMessages();
    else if (window._callToolbarContext && window.callSystem && typeof window.callSystem.refreshCallBubbles === "function") window.callSystem.refreshCallBubbles();
    else await renderDialogMessages();
    return;
  }

  const textToTranslate = extractBareTextForTranslation(msg);
  if (!textToTranslate) return;

  // 2. 发起 API 实时翻译
  showToast("正在翻译台词中...");
  try {
    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("请先在设置中配置 API！");

    const translatePrompt = `你是一个精准信达雅的专业同声翻译官。请将以下对话/文本内容无损翻译为流畅自然的中文。
要求：
- 如果文本中包含外文、俚语或方言（如粤语/日语/英语），请翻译为准确的中文意思。
- 绝对禁止包含任何多余的解释、问候或 Markdown 格式（如不需要写“翻译如下：”），直接输出翻译后的中文文本本身。

需要翻译的原文：
${textToTranslate}`;

    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: translatePrompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error("翻译接口响应失败");

    const result = await response.json();
    const translationText = result.choices[0].message.content.trim();

    // 3. 将翻译结果存入数据库，下次直接读取！
    await table.update(Number(msgId), {
      translatedContent: translationText,
      showTranslation: 1
    });

    showToast("翻译完成！");
    if (isOffline) await renderOfflineMessages();
    else if (window._callToolbarContext && window.callSystem && typeof window.callSystem.refreshCallBubbles === "function") window.callSystem.refreshCallBubbles();
    else await renderDialogMessages();

  } catch(err) {
    console.error(err);
    showCustomAlert("翻译失败", err.message);
  }
}
window.translateChatMessage = translateChatMessage;

// 高性能多选批量翻译引擎 (位置索引绝对对齐算法，彻底根治大模型篡改 ID 导致的翻译丢失 BUG)
async function batchTranslateMessages(isOffline = false) {
  const selector = isOffline ? ".offline-msg-checkbox:checked" : ".msg-checkbox:checked";
  const checked = document.querySelectorAll(selector);
  if (checked.length === 0) {
    showToast("请先勾选需要翻译的消息！");
    return;
  }

  const table = isOffline ? db.offline_messages : db.messages;
  const msgIds = Array.from(checked).map(c => Number(c.getAttribute("data-msg-id")));

  showToast(`正在批量翻译 ${msgIds.length} 条选中的消息...`);

  try {
    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("请先在设置中配置 API！");

    const untranslatedList = [];
    for (let id of msgIds) {
      const m = await table.get(id);
      if (m) {
        if (m.translatedContent) {
          await table.update(id, { showTranslation: 1 });
        } else {
          const bareText = extractBareTextForTranslation(m);
          if (bareText) {
            untranslatedList.push({ id: id, text: bareText });
          }
        }
      }
    }

    if (untranslatedList.length > 0) {
      const pureTexts = untranslatedList.map(item => item.text);
      const batchPrompt = `你是一个精准信达雅的同声翻译官。请将以下 JSON 数组中的多条文本依次翻译为流畅自然的中文。
要求：
- 提取俚语、方言或外文含义，翻译为准确的中文意思。
- 请直接且仅返回与输入数组长度完全一致的中文翻译 JSON 文本数组（不要包含 Markdown 格式与解释说明）：
[
  "第一条的中文翻译",
  "第二条的中文翻译"
]

需要翻译的文本数组：
${JSON.stringify(pureTexts)}`;

      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [{ role: "user", content: batchPrompt }],
          temperature: 0.3
        })
      });

      if (!response.ok) throw new Error("批量翻译接口响应失败");

      const result = await response.json();
      const rawText = result.choices[0].message.content.trim();
      const cleanJson = rawText.replace(/^```json/i, '').replace(/```$/i, '').trim();

      let parsedArray = [];
      try {
        parsedArray = JSON.parse(cleanJson);
      } catch(e) {
        console.warn("批量 JSON 解析失败，开启自动降级补救", e);
      }

      if (Array.isArray(parsedArray) && parsedArray.length > 0) {
        // 核心修正：按照物理位置数组索引 1:1 绝对映射，彻底杜绝 ID 丢失！
        for (let i = 0; i < untranslatedList.length; i++) {
          const targetId = untranslatedList[i].id;
          const translatedText = parsedArray[i];
          if (targetId && translatedText) {
            const cleanTrans = typeof translatedText === 'string' ? translatedText : (translatedText.translation || translatedText.text || JSON.stringify(translatedText));
            await table.update(targetId, {
              translatedContent: cleanTrans,
              showTranslation: 1
            });
          }
        }
      } else {
        for (let item of untranslatedList) {
          await translateChatMessage(item.id, isOffline);
        }
      }
    }

    showToast("批量翻译完成！");
    if (isOffline) {
      exitOfflineMultiSelectMode();
      await renderOfflineMessages();
    } else {
      exitMultiSelectMode();
      await renderDialogMessages();
    }

  } catch(err) {
    console.error(err);
    showCustomAlert("批量翻译失败", err.message);
  }
}
window.batchTranslateMessages = batchTranslateMessages;

// ============================================================
//                 消息格式修写中枢 (Format Repair Engine)
// ============================================================

let currentRepairMsgId = null;
let isRepairingOfflineMsg = false;
let repairUploadedImageBlob = null;

// 选择目标重塑格式（快捷药丸按键切换）
function selectRepairFormat(type, btnEl) {
  const container = document.getElementById("repair-format-pills-row");
  if (container) {
    container.querySelectorAll(".repair-pill-btn").forEach(b => {
      b.style.borderColor = "var(--border)";
      b.style.backgroundColor = "transparent";
      b.style.color = "var(--text-primary)";
    });
  }
  if (btnEl) {
    btnEl.style.borderColor = "#8b5cf6";
    btnEl.style.backgroundColor = "#f3e8ff";
    btnEl.style.color = "#7c3aed";
  }
  document.getElementById("repair-format-type-val").value = type;
  onRepairFormatTypeChange();
}
window.selectRepairFormat = selectRepairFormat;

// 开启格式修写弹窗并自动填充原文
async function openFormatRepairModal(msgId, isOffline = false) {
  currentRepairMsgId = Number(msgId);
  isRepairingOfflineMsg = isOffline;
  repairUploadedImageBlob = null;

  const table = isOffline ? db.offline_messages : db.messages;
  const msg = await table.get(currentRepairMsgId);
  if (!msg) return;

  const bareText = extractBareTextForTranslation(msg);

  // 1. 原文预填写至各个格式的文本框中
  document.getElementById("repair-input-text").value = bareText;
  document.getElementById("repair-input-image-text").value = bareText || "场景描述";
  document.getElementById("repair-input-voice-text").value = bareText || "...";
  document.getElementById("repair-input-red-remark").value = bareText || "恭喜发财，大吉大利";
  document.getElementById("repair-input-transfer-target").value = "";
  document.getElementById("repair-selected-sticker-caption").value = "";
  document.getElementById("repair-image-filename").innerText = "无附件";
  // 新增三格式预填：礼物/代付/位置
  document.getElementById("repair-input-gift-name").value = bareText || "";
  document.getElementById("repair-input-gift-message").value = bareText || "送给你的一份心意";
  document.getElementById("repair-input-payfor-name").value = bareText || "";
  document.getElementById("repair-input-payfor-message").value = bareText || "帮我付一下嘛~";
  document.getElementById("repair-input-loc-name").value = bareText || "";
  document.getElementById("repair-input-loc-coord").value = "";

  // 绑定图片选择回调
  const fileImg = document.getElementById("repair-file-image");
  if (fileImg) {
    fileImg.onchange = (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        document.getElementById("repair-image-filename").innerText = file.name;
        const reader = new FileReader();
        reader.onload = (evt) => {
          repairUploadedImageBlob = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    };
  }

  // 重置选择“文本”格式药丸按钮
  const firstPill = document.querySelector(".repair-pill-btn[data-type='text']");
  selectRepairFormat("text", firstPill);

  document.getElementById("custom-format-repair-overlay").classList.add("active");
}
window.openFormatRepairModal = openFormatRepairModal;

// 切换选择格式时的视图切分
async function onRepairFormatTypeChange() {
  const type = document.getElementById("repair-format-type-val").value;
  const fields = ["text", "image", "voice", "sticker", "transfer", "red-envelope", "gift", "pay_for_me", "location"];

  fields.forEach(f => {
    const el = document.getElementById(`repair-field-${f}`);
    if (el) el.style.display = (f === type || (f === 'red-envelope' && type === 'red_envelope')) ? "block" : "none";
  });

  if (type === 'sticker') {
    await renderRepairStickerPicker();
  }
}
window.onRepairFormatTypeChange = onRepairFormatTypeChange;

// 加载已挂载图柜供修写选择
async function renderRepairStickerPicker() {
  const grid = document.getElementById("repair-sticker-picker-grid");
  if (!grid) return;
  grid.innerHTML = "";

  let mountedGroupIds = [];
  if (window.stickerSystem && window.stickerSystem.getMountedGroupIds) {
    mountedGroupIds = await window.stickerSystem.getMountedGroupIds(activeSessionId);
  }

  if (mountedGroupIds.length === 0) {
    grid.innerHTML = `<div style="grid-column: span 4; font-size:10.5px; color:var(--text-secondary); text-align:center; padding:12px;">当前对话尚未挂载表情包分组，请前往单聊/群聊设置中挂载。</div>`;
    return;
  }

  const allStickers = [];
  for (let grpId of mountedGroupIds) {
    const items = await db.sticker_items.where('groupId').equals(grpId).toArray();
    allStickers.push(...items);
  }

  if (allStickers.length === 0) {
    grid.innerHTML = `<div style="grid-column: span 4; font-size:10.5px; color:var(--text-secondary); text-align:center; padding:12px;">已挂载的分组中暂无表情包条目。</div>`;
    return;
  }

  allStickers.forEach(st => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex; flex-direction:column; align-items:center; padding:4px; border-radius:6px; background:#fff; border:1.5px solid var(--border); cursor:pointer;";
    item.innerHTML = `
      <img src="${st.imageUrl}" style="width:36px; height:36px; object-fit:contain;">
      <span style="font-size:9px; color:var(--text-primary); max-width:44px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${escapeHtml(st.caption)}</span>
    `;
    item.onclick = () => {
      grid.querySelectorAll("div").forEach(d => { d.style.borderColor = "var(--border)"; d.style.background = "#fff"; });
      item.style.borderColor = "#8b5cf6";
      item.style.background = "#f3e8ff";
      document.getElementById("repair-selected-sticker-caption").value = st.caption;
    };
    grid.appendChild(item);
  });
}

// 提交格式修写落盘
async function submitFormatRepair() {
  if (!currentRepairMsgId) return;

  const type = document.getElementById("repair-format-type-val").value;
  const table = isRepairingOfflineMsg ? db.offline_messages : db.messages;
  const msg = await table.get(currentRepairMsgId);
  if (!msg) return;

  let newContentType = 'text';
  let newContent = "";

  if (type === 'text') {
    newContentType = 'text';
    newContent = document.getElementById("repair-input-text").value.trim();
  } else if (type === 'image') {
    newContentType = 'image';
    const cap = document.getElementById("repair-input-image-text").value.trim() || "场景画面";
    const imgData = {
      url: repairUploadedImageBlob || "",
      text: cap
    };
    newContent = JSON.stringify(imgData);
  } else if (type === 'voice') {
    newContentType = 'voice';
    const dur = parseInt(document.getElementById("repair-input-voice-dur").value) || 5;
    const txt = document.getElementById("repair-input-voice-text").value.trim() || "...";
    newContent = JSON.stringify({ duration: dur, text: txt });
  } else if (type === 'sticker') {
    const caption = document.getElementById("repair-selected-sticker-caption").value.trim();
    if (!caption) {
      showToast("请先在方格中点击选中一个表情包！");
      return;
    }
    newContentType = 'text';
    newContent = `【表情包：${caption}】`;
  } else if (type === 'transfer') {
    newContentType = 'transfer';
    const amt = parseFloat(document.getElementById("repair-input-transfer-amount").value) || 100;
    const tgt = document.getElementById("repair-input-transfer-target").value.trim();
    newContent = JSON.stringify({
      amount: amt,
      status: 'pending',
      targetName: tgt || ""
    });
  } else if (type === 'red_envelope') {
    newContentType = 'red_envelope';
    const envType = document.getElementById("repair-input-red-type").value;
    const amt = parseFloat(document.getElementById("repair-input-red-amount").value) || 50;
    const rmk = document.getElementById("repair-input-red-remark").value.trim() || "恭喜发财";
    newContent = JSON.stringify({
      amount: amt,
      status: 'pending',
      remark: rmk,
      type: envType
    });
  } else if (type === 'gift') {
    newContentType = 'gift';
    const gName = document.getElementById("repair-input-gift-name").value.trim() || "一份心意";
    const gPrice = parseFloat(document.getElementById("repair-input-gift-price").value) || 0;
    const gQty = parseInt(document.getElementById("repair-input-gift-qty").value) || 1;
    const gMsg = document.getElementById("repair-input-gift-message").value.trim() || "送给你的一份心意";
    newContent = JSON.stringify({
      items: [{ name: gName, price: gPrice, quantity: gQty }],
      total: gPrice * gQty,
      message: gMsg,
      status: 'gift'
    });
  } else if (type === 'pay_for_me') {
    newContentType = 'pay_for_me';
    const pName = document.getElementById("repair-input-payfor-name").value.trim() || "商品";
    const pPrice = parseFloat(document.getElementById("repair-input-payfor-price").value) || 0;
    const pQty = parseInt(document.getElementById("repair-input-payfor-qty").value) || 1;
    const pMsg = document.getElementById("repair-input-payfor-message").value.trim() || "";
    newContent = JSON.stringify({
      items: [{ name: pName, price: pPrice, quantity: pQty }],
      total: pPrice * pQty,
      message: pMsg,
      status: 'pending'
    });
  } else if (type === 'location') {
    newContentType = 'location';
    const lName = document.getElementById("repair-input-loc-name").value.trim() || "未知位置";
    let lCoord = document.getElementById("repair-input-loc-coord").value.trim();
    if (!lCoord) {
      const lat = (Math.random() * (53.55 - 18.0) + 18.0).toFixed(6);
      const lng = (Math.random() * (135.08 - 73.66) + 73.66).toFixed(6);
      lCoord = `${lat},${lng}`;
    }
    newContent = JSON.stringify({ name: lName, coord: lCoord });
  }

  // 落盘重写数据库并重绘
  await table.update(currentRepairMsgId, {
    contentType: newContentType,
    content: newContent
  });

  document.getElementById("custom-format-repair-overlay").classList.remove("active");
  showToast("格式修复成功！");

  if (isRepairingOfflineMsg) await renderOfflineMessages();
  else {
    if (window._callToolbarContext && window.callSystem && typeof window.callSystem.refreshCallBubbles === "function") {
      window.callSystem.refreshCallBubbles();
    } else {
      await renderDialogMessages();
    }
  }
}
window.submitFormatRepair = submitFormatRepair;

// 脚本载入时完成全局顶级、单次安全绑定
initContextMenuHandlers();
initOfflineContextMenuHandlers(); 
bindChatAppEvents();
bindOfflineChatAppEvents();
bindMultimediaEvents(); // 核心挂载：多媒体弹窗交互