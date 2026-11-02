// app_status.js - 角色状态/内心窥探(心声)与数据引擎

let activeStatusSessionId = null;
let activeStatusScope = 'online';   // 当前这张心声卡看的是哪个场景：online / date / theater
let isStatusInitializing = false;

// 心声来源隔离：status_history 里 isTheater=0 同时被「线上」和「赴约」写入，
// 读的时候会互相串台。新记录显式带 source（online / date / theater），按 source 精确过滤；
// 旧记录没有 source，只能按 isTheater 兜底（线上与赴约无法区分，统一视为线上）。
function resolveStatusScope() {
  if (typeof isOfflineTheater !== 'undefined' && isOfflineTheater) return 'theater';
  if (typeof activeTheaterId !== 'undefined' && activeTheaterId > 0) return 'theater';
  return 'online';
}

function statusRecordMatchesScope(h, scope) {
  if (!h) return false;
  if (h.source) return h.source === scope;
  // 旧数据兜底
  if (scope === 'theater') return h.isTheater === 1;
  // 老数据里「线上」与「赴约」都是 isTheater=0 且 theaterId=0，无法区分；统一按线上处理
  return h.isTheater === 0 && (Number(h.theaterId) || 0) === 0;
}

// 该场景的展示用标签
function statusScopeLabel(scope) {
  if (scope === 'theater') return '小剧场';
  if (scope === 'date') return '赴约';
  return '线上';
}

// 窥秘主逻辑初始化
function initStatusApp() {
  if (isStatusInitializing) return;
  isStatusInitializing = true;

  // 事件委托修复：心声按钮可能在动态渲染/切换会话时被重建，
  // 之前用 btn.onclick 直接绑定，一旦 DOM 被重建绑定就丢失，导致点击无反应。
  // 改为在 document 上做事件委托，无论按钮何时重建都能响应点击。
  document.addEventListener("click", function statusBtnHandler(e) {
    const onlineBtn = e.target.closest("#btn-char-status");
    if (onlineBtn) {
      e.preventDefault();
      openStatusCard(activeSessionId, 'online');
      return;
    }
    const offlineBtn = e.target.closest("#btn-offline-char-status");
    if (offlineBtn) {
      e.preventDefault();
      const scope = (typeof isOfflineTheater !== 'undefined' && isOfflineTheater) ? 'theater' : 'date';
      openStatusCard(activeSessionId, scope);
      return;
    }
  });

  // 兼容性兜底：若按钮已存在也直接绑定（旧逻辑保留）
  const btnOnline = document.getElementById("btn-char-status");
  if (btnOnline && !btnOnline.dataset.statusBound) {
    btnOnline.dataset.statusBound = "1";
    btnOnline.onclick = () => openStatusCard(activeSessionId, 'online');
  }
  const btnOffline = document.getElementById("btn-offline-char-status");
  if (btnOffline && !btnOffline.dataset.statusBound) {
    btnOffline.dataset.statusBound = "1";
    btnOffline.onclick = () => {
      const scope = (typeof isOfflineTheater !== 'undefined' && isOfflineTheater) ? 'theater' : 'date';
      openStatusCard(activeSessionId, scope);
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
// scope 由调用方（按钮）明确指定：'online' / 'date' / 'theater'
async function openStatusCard(sessionId, scope) {
  if (!sessionId) {
    showToast("当前无活跃会话，请先选择一个角色进行对话");
    return;
  }
  activeStatusSessionId = sessionId;
  activeStatusScope = (scope === 'theater' || scope === 'date') ? scope : 'online';

  document.getElementById("status-card-overlay").classList.add("active");

  // 先清空展示，加载已存的历史记录中最新的一条
  resetStatusFields();

  // 标题上写清楚这张卡属于哪个场景，避免用户以为串台
  try {
    const titleEl = document.getElementById("status-card-scope-label");
    if (titleEl) titleEl.innerText = statusScopeLabel(activeStatusScope);
  } catch (e) {}

  try {
    // 按来源精确过滤（线上 / 赴约 / 小剧场 各自独立，互不串台）
    const list = await db.status_history
      .where('sessionId').equals(sessionId)
      .and(h => statusRecordMatchesScope(h, activeStatusScope))
      .toArray();
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (list.length > 0) {
      displayStatusFields(list[0]);
    } else {
      // 提示加载
      document.getElementById("status-attire").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-affection").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-excitement").innerText = "请点击下方深度同频同步状态...";
      document.getElementById("status-thoughts").innerText = `暂无${statusScopeLabel(activeStatusScope)}心声数据。`;
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

    // 兜底：如果卡片 scope 是线上，但全局标志还在线下（历史 bug 的残留状态），
    // 强制把标志归位，保证「读哪套对话」与「写什么 source」都落在线上
    const scopeGuard = activeStatusScope || 'online';
    if (scopeGuard === 'online' && typeof isOfflineTheater !== 'undefined' && isOfflineTheater) {
      console.warn('[心声] 检测到线下标志残留，已按线上场景生成');
      isOfflineTheater = false;
      activeTheaterId = 0;
    }

    const sess = await db.sessions.get(activeStatusSessionId);
    if (!sess) throw new Error("无法加载当前会话。");

    const char = await db.archives.get(sess.charId);
    const user = await db.archives.get(sess.userId);

    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || user?.name || "我";
    const charPersona = sess.customCharPersona || char?.persona || "";
    const userPersona = sess.customUserPersona || user?.persona || "";

    // 获取最近的对话内容
    // v1.5.19：改用卡片自己的 activeStatusScope 决定读哪套对话，不再看残留的 isOfflineTheater
    // （否则离开小剧场后，线上同频生成的仍然是剧场对话推理出来的心声，这就是「线上都有交流了、
    //   生成的心声还是关于小剧场的」的直接原因）
    const syncScope = activeStatusScope || 'online';
    let conversationText = "";
    if (syncScope === 'theater' || syncScope === 'date') {
      // 线下对话记录
      let rawList = [];
      if (syncScope === 'theater' && typeof activeTheaterId !== 'undefined' && activeTheaterId > 0) {
        rawList = await db.offline_messages.where('theaterId').equals(activeTheaterId).sortBy('timestamp');
      } else {
        rawList = await db.offline_messages
          .where('sessionId').equals(activeStatusSessionId)
          .and(m => Number(m.isTheater) === (syncScope === 'theater' ? 1 : 0))
          .sortBy('timestamp');
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

    // 查询社会关系网络：复用统一的 queryRelationship（含关系网里的其他人物，
    // 不再是只按 fromId/toId 裸查 relations 表那套取不到数据的写法）
    let relationshipDesc = "";
    try {
      if (typeof queryRelationship === 'function') {
        relationshipDesc = await queryRelationship(sess.userId, sess.charId, userName, charName);
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

    let statusContent;
    const statusMessages = [{ role: "user", content: systemPrompt }];
    if (typeof window.fwCallLLM === "function") {
      try {
        statusContent = await window.fwCallLLM(api, statusMessages, { temperature: 0.8 });
      } catch(e) { /* fall through to original fetch */ }
    }
    if (statusContent === undefined) {
      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: statusMessages,
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

      statusContent = result.choices[0].message.content;
    }
    let rawJson = statusContent.trim();
    
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
    // v1.5.19：source 与 theaterId/isTheater 必须和卡片 scope 一致，
    // 否则「手动深度同频」写出来的记录下一次按 scope 读不到（卡片就一直显示旧剧场那条）
    const saveScope = activeStatusScope || 'online';
    const record = {
      sessionId: activeStatusSessionId,
      theaterId: (saveScope === 'theater' && typeof activeTheaterId !== 'undefined' && activeTheaterId > 0) ? activeTheaterId : 0,
      isTheater: saveScope === 'theater' ? 1 : 0,
      source: saveScope,
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
    showToast(`深度同频失败: ${err.message}`);
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
    // 与主卡片同源：沿用卡片打开时确定的 scope，避免历史列表串台
    const scope = activeStatusScope || resolveStatusScope();
    const list = await db.status_history
      .where('sessionId').equals(activeStatusSessionId)
      .and(h => statusRecordMatchesScope(h, scope))
      .toArray();
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (list.length === 0) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">暂无${statusScopeLabel(scope)}心声历史</p>`;
      return;
    }

    list.forEach(item => {
      const card = document.createElement("div");
      card.className = "history-item-card";

      const timeStr = new Date(item.timestamp).toLocaleString();
      card.innerHTML = `
        <div class="history-time-badge" style="display: flex; justify-content: space-between; align-items: center;">
          <span>🕒 记录时间：${timeStr}</span>
          <button class="delete-status-btn" style="background: none; border: none; color: #ff4d4f; cursor: pointer; padding: 4px; border-radius: 4px;" aria-label="删除记录">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
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
      
      const delBtn = card.querySelector('.delete-status-btn');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const doDelete = async () => {
            try {
              if (item.id) {
                await db.status_history.delete(item.id);
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                setTimeout(() => card.remove(), 200);

                // 如果删除后列表空了，显示无数据提示
                if (container.querySelectorAll('.history-item-card').length <= 1) {
                  setTimeout(() => {
                    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">暂无${statusScopeLabel(activeStatusScope)}心声历史</p>`;
                  }, 250);
                }
              }
            } catch (err) {
              console.error('删除心声记录失败:', err);
              showToast('删除失败: ' + err.message);
            }
          };
          // 项目红线：不用原生 confirm
          if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('删除同频记录', '确定要删除这一条心声记录吗？删除后无法恢复。', doDelete);
          } else {
            await doDelete();
          }
        };
      }
      
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