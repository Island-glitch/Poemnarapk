// app_status.js - 角色状态/内心窥探(心声)与数据引擎

let activeStatusSessionId = null;
let isStatusInitializing = false;

// 窥秘主逻辑初始化
function initStatusApp() {
  if (isStatusInitializing) return;
  isStatusInitializing = true;

  // 绑定在线聊天与线下见面的状态粉色按钮
  const btnOnline = document.getElementById("btn-char-status");
  if (btnOnline) {
    btnOnline.onclick = () => openStatusCard(activeSessionId);
  }

  const btnOffline = document.getElementById("btn-offline-char-status");
  if (btnOffline) {
    btnOffline.onclick = () => {
      openStatusCard(activeSessionId);
    };
  }

  // 关闭主卡片按钮
  const btnClose = document.getElementById("btn-close-status-card");
  if (btnClose) {
    btnClose.onclick = () => {
      document.getElementById("status-card-overlay").classList.remove("active");
    };
  }

  // 查看历史状态按钮
  const btnHistory = document.getElementById("btn-status-history");
  if (btnHistory) {
    btnHistory.onclick = () => {
      openStatusHistory();
    };
  }

  const btnCloseHistory = document.getElementById("btn-close-status-history");
  if (btnCloseHistory) {
    btnCloseHistory.onclick = () => {
      document.getElementById("status-history-overlay").classList.remove("active");
    };
  }

  // 刷新（重新同步）按钮
  const btnRefresh = document.getElementById("btn-refresh-status");
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      syncStatusFromAPI();
    };
  }
}

// 展开卡片，加载最新历史，若没有，则引导同步
async function openStatusCard(sessionId) {
  if (!sessionId) {
    alert("当前无活跃会话，请先选择一个角色进行对话。");
    return;
  }
  activeStatusSessionId = sessionId;

  document.getElementById("status-card-overlay").classList.add("active");

  // 先清空展示，加载已存的历史记录中最新的一条
  resetStatusFields();

  try {
    // 根据是否处于剧场模式区分保存
    let latest = null;
    if (isOfflineTheater) {
      latest = await db.status_history
        .where('sessionId').equals(sessionId)
        .and(h => h.isTheater === 1 && h.theaterId === activeTheaterId)
        .reverse()
        .sortBy('timestamp');
    } else {
      latest = await db.status_history
        .where('sessionId').equals(sessionId)
        .and(h => h.isTheater === 0)
        .reverse()
        .sortBy('timestamp');
    }

    if (latest && latest.length > 0) {
      displayStatusFields(latest[0]);
    } else {
      // 提示加载
      document.getElementById("status-attire").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-affection").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-excitement").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-thoughts").innerText = "暂无脑电波心声数据。";
      document.getElementById("status-hidden-corners").innerText = "未同频时，深藏心底的暗色情绪将无法洞察。";
    }
  } catch (err) {
    console.error("加载状态异常", err);
  }
}

function resetStatusFields() {
  document.getElementById("status-card-content").style.display = "block";
  document.getElementById("status-card-loading").style.display = "none";
}

function displayStatusFields(data) {
  document.getElementById("status-attire").innerText = data.attire || "暂无描述";
  document.getElementById("status-affection").innerText = data.affection || "暂无数据";
  document.getElementById("status-excitement").innerText = data.excitement || "暂无数据";
  document.getElementById("status-thoughts").innerText = data.thoughts || "暂无想法";
  document.getElementById("status-hidden-corners").innerText = data.hiddenCorners || "此深度无任何阴暗面。";
}

// 核心同步逻辑：发起 API 调用
async function syncStatusFromAPI() {
  const contentArea = document.getElementById("status-card-content");
  const loadingArea = document.getElementById("status-card-loading");
  const btnRefresh = document.getElementById("btn-refresh-status");

  contentArea.style.display = "none";
  loadingArea.style.display = "flex";
  btnRefresh.disabled = true;

  try {
    const presetId = localStorage.getItem("global_api_preset_id");
    if (!presetId) throw new Error("未配置全局默认 API，请前往‘系统设置 - API 协议设置’中配置并应用！");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("所选的 API 预设可能已被删除，请重新配置！");

    const sess = await db.sessions.get(activeStatusSessionId);
    if (!sess) throw new Error("无法加载当前会话。");

    const char = await db.archives.get(sess.charId);
    const user = await db.archives.get(sess.userId);

    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || user?.name || "我";
    const charPersona = sess.customCharPersona || char?.persona || "";
    const userPersona = sess.customUserPersona || user?.persona || "";

    // 获取最近的对话内容
    let conversationText = "";
    if (isOfflineTheater || (activeTheaterId && activeTheaterId > 0)) {
      // 线下对话记录
      let rawList = [];
      if (activeTheaterId && activeTheaterId > 0) {
        rawList = await db.offline_messages.where('theaterId').equals(activeTheaterId).sortBy('timestamp');
      } else {
        rawList = await db.offline_messages.where('sessionId').equals(activeStatusSessionId).and(m => m.isTheater === 0).sortBy('timestamp');
      }
      const history = rawList.slice(-15);
      history.forEach(h => {
        const name = h.senderType === 'user' ? userName : charName;
        conversationText += `[${name}]: ${h.content}\n`;
      });
    } else {
      // 线上普通对话
      const history = await db.messages.where('sessionId').equals(activeStatusSessionId).reverse().limit(15).toArray();
      history.reverse();
      history.forEach(h => {
        const name = h.senderType === 'user' ? userName : charName;
        conversationText += `[${name}]: ${h.content}\n`;
      });
    }

    if (!conversationText) {
      conversationText = "(暂无对话历史，双方尚未开始对话交流。)";
    }

    // 查询社会关系网络
    let relationshipDesc = "";
    try {
      const rels = await db.relations.where('fromId').equals(Number(sess.userId)).toArray();
      const matchedRel = rels.find(r => r.toId === Number(sess.charId));
      if (matchedRel) {
        relationshipDesc = `用户 [${userName}] 是 [${charName}] 的 [${matchedRel.relation}]`;
      } else {
        const rels2 = await db.relations.where('fromId').equals(Number(sess.charId)).toArray();
        const matchedRel2 = rels2.find(r => r.toId === Number(sess.userId));
        if (matchedRel2) {
          relationshipDesc = `[${charName}] 是用户 [${userName}] 的 [${matchedRel2.relation}]`;
        }
      }
    } catch (e) {
      console.warn("查询关系失败", e);
    }
    if (!relationshipDesc) {
      relationshipDesc = "你们是普通的即时通讯好友。";
    }

    // 拼装 Prompt 
    const systemPrompt = `你是一个深层心理和情感窥探引擎。当前角色 [${charName}] 正在与用户 [${userName}] 进行虚拟角色扮演互动。
根据以下提供的人设、社会关系，以及最近的对话或白描互动记录，深度推理分析该角色[此刻]的当前穿着、对用户的好感度、当前兴奋值（情绪高涨、躁动或精神紧绷度）、此刻最真实的内心想法（极度感性地对待用户的话语或举动）、以及深藏心底绝对不愿暴露的隐秘角落（极端的占有欲、内疚、黑暗渴望、反差冲动、秘密自卑或心口不一的谋划等）。

【人设背景设定】
[${charName}] 的设定背景：
${charPersona}

[${userName}] 的设定背景：
${userPersona}

社会/亲疏关系：
${relationshipDesc}

【最近对话与白描历史】
${conversationText}

请完全在人设和关系框架下，严密推导。请直接、干净地输出一个标准 JSON 结构，【绝对禁止】输出任何多余的解释性描述文字，【绝对禁止】包含任何 Markdown 格式包裹（如不需要 \`\`\`json ）。
JSON 格式格式如下：
{
  "attire": "详细描述此刻该角色贴合目前语境与地点的衣服、搭配、零碎饰物等",
  "affection": "好感描述，需包含百分比（如：82% / 焦灼渴望，加上富有表现力的简短说明）",
  "excitement": "兴奋/情绪紧绷值，需包含百分比（如：45% / 略有局促，说明原因）",
  "thoughts": "此刻其脑海中对用户所说/所做的极具感情、甚至饱含情感温度的最真实自白",
  "hiddenCorners": "心底深处绝对无法言说、不愿让对方得知的自私冲动、强烈占有、阴暗欲望、情感拉扯、扭曲秘密等"
}
`;

    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: systemPrompt }],
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} 错误: ${errText}`);
    }

    const result = await response.json();
    if (!result.choices || result.choices.length === 0) {
      throw new Error("模型服务返回 Choice 节点为空。");
    }

    let rawJson = result.choices[0].message.content.trim();
    
    // 强力清洗 markdown 包裹字符
    if (rawJson.startsWith("```")) {
      rawJson = rawJson.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    }
    
    // 鲁棒解析
    let parsedData = null;
    try {
      parsedData = JSON.parse(rawJson);
    } catch (parseErr) {
      // 如果解析失败，尝试正则表达式匹配 JSON 结构
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        parsedData = JSON.parse(match[0]);
      } else {
        throw parseErr;
      }
    }

    // 核心自愈：自动检索并替换心声内容里出现的 "user"、"User"、"USER" 占位符为我方当前面具的真实名字 [1]
    const userRegex = /\buser\b/gi;
    const cleanProp = (val) => {
      if (typeof val !== 'string') return val;
      return val.replace(userRegex, userName);
    };

    // 保存到 IndexedDB
    const record = {
      sessionId: activeStatusSessionId,
      theaterId: isOfflineTheater ? activeTheaterId : 0,
      isTheater: isOfflineTheater ? 1 : 0,
      timestamp: Date.now(),
      attire: cleanProp(parsedData.attire) || "未详",
      affection: cleanProp(parsedData.affection) || "未详",
      excitement: cleanProp(parsedData.excitement) || "未详",
      thoughts: cleanProp(parsedData.thoughts) || "未详",
      hiddenCorners: cleanProp(parsedData.hiddenCorners) || "无"
    };

    await db.status_history.add(record);

    // 显示
    displayStatusFields(record);

  } catch (err) {
    console.error("同步角色状态卡片失败", err);
    alert(`深度同频失败: ${err.message}`);
    // 恢复先前状态或引导重新获取
    document.getElementById("status-attire").innerText = "同频发生异常错误";
    document.getElementById("status-affection").innerText = "未能建立神经同步";
    document.getElementById("status-excitement").innerText = "同步中断";
    document.getElementById("status-thoughts").innerText = err.message;
    document.getElementById("status-hidden-corners").innerText = "无数据";
  } finally {
    contentArea.style.display = "block";
    loadingArea.style.display = "none";
    btnRefresh.disabled = false;
  }
}

// 展现历史记录列表
async function openStatusHistory() {
  const container = document.getElementById("status-history-list");
  if (!container) return;
  container.innerHTML = "";

  document.getElementById("status-history-overlay").classList.add("active");

  try {
    let list = [];
    if (isOfflineTheater) {
      list = await db.status_history
        .where('sessionId').equals(activeStatusSessionId)
        .and(h => h.isTheater === 1 && h.theaterId === activeTheaterId)
        .reverse()
        .sortBy('timestamp');
    } else {
      list = await db.status_history
        .where('sessionId').equals(activeStatusSessionId)
        .and(h => h.isTheater === 0)
        .reverse()
        .sortBy('timestamp');
    }

    if (list.length === 0) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">该场景暂无心声同频历史</p>`;
      return;
    }

    list.forEach(item => {
      const card = document.createElement("div");
      card.className = "history-item-card";

      const timeStr = new Date(item.timestamp).toLocaleString();
      card.innerHTML = `
        <div class="history-time-badge">🕒 记录时间：${timeStr}</div>
        <div class="status-attribute-row" style="margin-bottom: 8px; padding: 10px;">
          <div class="attr-label">👚 穿着</div>
          <div class="attr-value" style="font-size:13px;">${item.attire}</div>
        </div>
        <div style="display:flex; gap: 8px; margin-bottom: 8px;">
          <div class="status-attribute-row" style="flex: 1; margin-bottom: 0; padding: 10px;">
            <div class="attr-label">❤️ 好感度</div>
            <div class="attr-value" style="font-size:13px;">${item.affection}</div>
          </div>
          <div class="status-attribute-row" style="flex: 1; margin-bottom: 0; padding: 10px;">
            <div class="attr-label">⚡ 兴奋值</div>
            <div class="attr-value" style="font-size:13px;">${item.excitement}</div>
          </div>
        </div>
        <div class="status-attribute-row long-text" style="margin-bottom: 8px; padding: 10px;">
          <div class="attr-label">💭 内心想法</div>
          <div class="attr-value" style="font-size:13px;">${item.thoughts}</div>
        </div>
        <div class="status-attribute-row long-text shadow-box" style="margin-bottom: 0; padding: 10px;">
          <div class="attr-label">🕯️ 隐秘角落</div>
          <div class="attr-value" style="font-size:13px;">${item.hiddenCorners}</div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error("加载历史出错", err);
  }
}

// 脚本载入时挂载
document.addEventListener("DOMContentLoaded", () => {
  initStatusApp();
});