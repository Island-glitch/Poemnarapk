/**
 * app_deeptalk.js - 深谈应用核心逻辑控制器 (面具随动与剖白提取系统)
 */

let deeptalkCurrentTab = 'select';
let activeDeeptalkId = null;

// 0. 自闭环底层辅助函数，斩断跨文件 ReferenceError 引起的进程死锁
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

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

// ========================================================
//              【核心重构：双通道自愈清洗引擎】
// ========================================================

/**
 * 1. 独立对话通道拦截器 (专用于对话流程)
 * 作用：从整段对话中拦截并提取末尾的 [THOUGHT] 闪念，并将该部分从原对话中安全擦除
 */
function extractDialogueThought(replyText) {
  let thought = "";
  let cleanReply = replyText;

  // 匹配 [THOUGHT]...[/THOUGHT] 包装 (支持中英文括号、不区分大小写、支持右侧未闭合降级)
  const thoughtRegex = /[\[【]THOUGHT[\]】]([\s\S]*?)(?:[\[【]\/THOUGHT[\]】]|$)/i;
  const match = replyText.match(thoughtRegex);

  if (match) {
    thought = match[1].trim();
    // 擦除对话中已经被捕获的标签内容，避免污染聊天气泡
    cleanReply = replyText.replace(thoughtRegex, "").trim();
  }

  return {
    thought: cleanManualThought(thought), // 提取出来的闪念依然走深层洗涤
    replyText: cleanReply
  };
}

/**
 * 2. 独立手动通道清洗器 (专用于手动点击提炼)
 * 作用：直接清洗 AI 单独输出的思想内容。高容错兼容各种 markdown、引号、标签遗留等
 */
function cleanManualThought(text) {
  if (!text) return "";
  const original = text.trim();
  let cleaned = original;

  // A. 如果 AI 在手动模式下仍然固执地套用了 [THOUGHT] 标签，先剥离标签
  const match = cleaned.match(/[\[【]THOUGHT[\]】]([\s\S]*?)(?:[\[【]\/THOUGHT[\]】]|$)/i);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }

  // B. 剔除可能多余的 thought 标签文字
  cleaned = cleaned.replace(/[\[【]\/?thought[\]】]/gi, "").trim();

  // C. 剥离可能存在的 Markdown 语法格式
  cleaned = cleaned.replace(/```[a-zA-Z]*\n?/g, "");
  cleaned = cleaned.replace(/```/g, "");
  cleaned = cleaned.replace(/`/g, "");

  // D. 强力剔除首尾的多余修饰符 (中英文引号、双引号、括号、书名号、冒号、空行)
  cleaned = cleaned.replace(/^[\s"'“‘【\[\(《「:：,，。.\-\s]+/g, "").trim();
  cleaned = cleaned.replace(/[\s"'”’】\]\)》」,，。.\-\s]+$/g, "").trim();

  // E. 剔除常见的 AI 引导性废话前缀
  cleaned = cleaned.replace(/^(我的内心闪念是|我的内心想法是|我的闪念是|内心想法|内心剖白|闪念|想法|自省闪念)[:：\s]*/, "").trim();

  // F. 安全降级兜底：若经过激进清洗后完全变空，而原输入有字，则返回仅进行基础符号剥离的原文字
  if (!cleaned && original) {
    return original.replace(/[\[【]\/?thought[\]】]/gi, "")
                   .replace(/^[\s"']+/g, "")
                   .replace(/[\s"']+$/g, "")
                   .trim();
  }

  return cleaned.trim();
}

// ========================================================
//              【深谈基础页面交互流程控制】
// ========================================================

// 1. 初始化深谈应用
async function initDeeptalkApp() {
  await renderDeeptalkTab();

  const tabs = document.querySelectorAll("#win-deeptalk .chat-tabs .tab-item");
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      deeptalkCurrentTab = tab.getAttribute("data-tab");

      const mainTitle = document.getElementById("deeptalk-main-title");
      if (mainTitle) {
        mainTitle.innerText = deeptalkCurrentTab === 'select' ? "深谈" : "小宇宙";
      }

      const btnNew = document.getElementById("btn-new-deeptalk");
      if (btnNew) {
        btnNew.style.display = deeptalkCurrentTab === 'select' ? 'flex' : 'none';
      }

      renderDeeptalkTab();
    };
  });
}

// 2. 渲染切签选项卡 (择选 / 小宇宙)
async function renderDeeptalkTab() {
  const activeMeId = localStorage.getItem("active_me_id");
  const userIdNum = Number(activeMeId);
  
  if (!activeMeId || isNaN(userIdNum)) {
    document.getElementById("deeptalk-tab-select").innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">请先到 “我的” 选项卡下选择我的人设！</p>`;
    document.getElementById("deeptalk-tab-microcosm").innerHTML = "";
    return;
  }

  if (deeptalkCurrentTab === 'select') {
    document.getElementById("deeptalk-tab-select").classList.add("active");
    document.getElementById("deeptalk-tab-microcosm").classList.remove("active");
    await renderSelectTab();
  } else {
    document.getElementById("deeptalk-tab-select").classList.remove("active");
    document.getElementById("deeptalk-tab-microcosm").classList.add("active");
    await renderMicrocosmTab();
  }
}

// 3. 渲染“择选”主界面
async function renderSelectTab() {
  const selectContainer = document.getElementById("deeptalk-tab-select");
  if (!selectContainer) return;

  const activeMeId = localStorage.getItem("active_me_id");
  const userIdNum = Number(activeMeId);

  // 核心解耦：拉取会话列表后，过滤并切除所有群聊会话，保证深谈择选仅对单聊（1对1私密灵魂剖白）起效
  const sessions = (await db.sessions.where('userId').equals(userIdNum).toArray())
    .filter(s => s.isGroup !== 1);
  
  let candidatesHtml = `<div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">开始新深谈</div>
                        <div class="session-list" style="margin-bottom: 24px;">`;

  if (sessions.length === 0) {
    candidatesHtml += `<p style="text-align:center;color:var(--text-secondary);font-size:12px;padding:10px 0;">暂无可建立深谈的好友会话</p>`;
  } else {
    for (let s of sessions) {
      const char = await db.archives.get(s.charId);
      candidatesHtml += `
        <div class="session-item" onclick="openNewDeeptalkForm(${s.id}, ${s.charId})" style="padding:10px; border-radius:10px; background:#ffffff; margin-bottom:8px; border:1px solid var(--border);">
          <img class="session-avatar" src="${resolveAvatar(s.customCharAvatar || char?.avatar)}" style="width:36px; height:36px; border-radius:50%;">
          <div class="session-detail" style="margin-left:10px;">
            <div class="session-name" style="font-size:13px; font-weight:700;">与 ${s.customCharName || char?.name} 开启深谈</div>
          </div>
        </div>
      `;
    }
  }
  candidatesHtml += `</div>`;

  const activeTalks = await db.deeptalks
    .where('userId').equals(userIdNum)
    .and(t => t.status === 'active')
    .toArray();

  let activeHtml = `<div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">进行中的深谈</div>
                    <div class="session-list" style="margin-bottom: 20px;">`;

  if (activeTalks.length === 0) {
    activeHtml += `<p style="text-align:center;color:var(--text-secondary);font-size:12px;padding:20px 0;">暂无正在进行的深谈空间</p>`;
  } else {
    for (let t of activeTalks) {
      const char = await db.archives.get(t.charId);
      activeHtml += `
        <div class="session-item" onclick="openDeeptalkRoom(${t.id})" style="padding:12px; border-radius:12px; background:#ffffff; margin-bottom:10px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center;">
            <img class="session-avatar" src="${resolveAvatar(char?.avatar)}" style="width:40px; height:40px; border-radius:50%;">
            <div style="margin-left:12px;">
              <div style="font-size:14px; font-weight:700; color:var(--text-primary);">${t.topic}</div>
              <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">伙伴: ${char?.name}</div>
            </div>
          </div>
          <svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--text-secondary);"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
        </div>
      `;
    }
  }
  activeHtml += `</div>`;

  const finishedTalks = await db.deeptalks
    .where('userId').equals(userIdNum)
    .and(t => t.status === 'finished')
    .toArray();

  let finishedHtml = `<div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">已结束的深谈 (归档只读)</div>
                      <div class="session-list">`;

  if (finishedTalks.length === 0) {
    finishedHtml += `<p style="text-align:center;color:var(--text-secondary);font-size:12px;padding:20px 0;">暂无已结束的深谈历史</p>`;
  } else {
    for (let t of finishedTalks) {
      const char = await db.archives.get(t.charId);
      finishedHtml += `
        <div class="session-item" onclick="openDeeptalkRoom(${t.id})" style="padding:12px; border-radius:12px; background:#f1f5f9; opacity: 0.85; margin-bottom:10px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center;">
            <img class="session-avatar" src="${resolveAvatar(char?.avatar)}" style="width:40px; height:40px; border-radius:50%;">
            <div style="margin-left:12px;">
              <div style="font-size:14px; font-weight:700; color:var(--text-secondary); text-decoration: line-through;">${t.topic}</div>
              <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">伙伴: ${char?.name} (已归档)</div>
            </div>
          </div>
          <svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--text-secondary);"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
        </div>
      `;
    }
  }
  finishedHtml += `</div>`;

  selectContainer.innerHTML = `
    <div style="padding: 16px;">
      ${candidatesHtml}
      ${activeHtml}
      ${finishedHtml}
    </div>
  `;
}

// 4. 新建深谈表单唤起
function openNewDeeptalkForm(sessionId, charId) {
  document.getElementById("deeptalk-form-session-id").value = sessionId;
  document.getElementById("deeptalk-form-char-id").value = charId;
  document.getElementById("deeptalk-form-topic").value = "";
  document.getElementById("deeptalk-form-details").value = "";
  document.getElementById("deeptalk-create-overlay").classList.add("active");
}

function closeNewDeeptalkForm() {
  document.getElementById("deeptalk-create-overlay").classList.remove("active");
}

async function createDeeptalkRecord() {
  const sessionId = Number(document.getElementById("deeptalk-form-session-id").value);
  const charId = Number(document.getElementById("deeptalk-form-char-id").value);
  const topic = document.getElementById("deeptalk-form-topic").value.trim();
  const details = document.getElementById("deeptalk-form-details").value.trim();

  if (!topic || topic.length > 15) {
    showToast("请填写深谈主题，且字数限制在 15 字以内！");
    return;
  }

  const activeMeId = localStorage.getItem("active_me_id");
  const userIdNum = Number(activeMeId);

  const deeptalkId = await db.deeptalks.add({
    sessionId,
    userId: userIdNum,
    charId,
    topic,
    details,
    status: 'active',
    createdAt: Date.now()
  });

  closeNewDeeptalkForm();
  await renderSelectTab();
  openDeeptalkRoom(deeptalkId);
}

// 5. 进入专属深谈对话空间 (卡片式横向切换，支持对结束归档会话的只读限制)
async function openDeeptalkRoom(deeptalkId) {
  activeDeeptalkId = deeptalkId;
  const talk = await db.deeptalks.get(deeptalkId);
  const char = await db.archives.get(talk.charId);

  document.getElementById("deeptalk-room-title").innerText = talk.topic;
  document.getElementById("win-deeptalk-room").classList.add("active");

  const inputEl = document.getElementById("deeptalk-room-input");
  const btnSend = document.getElementById("btn-deeptalk-send");

  if (talk.status === 'finished') {
    if (inputEl) {
      inputEl.value = "";
      inputEl.disabled = true;
      inputEl.placeholder = "当前深谈已结束并归档为只读模式";
    }
    if (btnSend) btnSend.style.display = "none";
  } else {
    if (inputEl) {
      inputEl.value = "";
      inputEl.disabled = false;
      inputEl.placeholder = "请对角色说点什么来进行灵魂质询...";
    }
    if (btnSend) btnSend.style.display = "flex";
  }

  await renderDeeptalkCards();
}

function closeDeeptalkRoom() {
  document.getElementById("win-deeptalk-room").classList.remove("active");
  renderSelectTab();
}

async function renderDeeptalkCards() {
  const slider = document.getElementById("deeptalk-cards-flow");
  const dotsContainer = document.getElementById("deeptalk-dots-bar");
  if (!slider) return;

  slider.innerHTML = "";
  if (dotsContainer) dotsContainer.innerHTML = "";

  const rawMessages = await db.deeptalk_messages.where('deeptalkId').equals(activeDeeptalkId).toArray();
  const messages = rawMessages.sort((a,b) => a.timestamp - b.timestamp);
  
  let cardTurns = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.senderType === 'user') {
      const charReply = messages.find((r, idx) => idx > messages.indexOf(m) && r.senderType === 'char');
      cardTurns.push({
        userMsg: m.content,
        charMsg: charReply ? charReply.content : "正在剖白内心，等待思考中...",
        userMsgId: m.id,
        charMsgId: charReply ? charReply.id : null
      });
    }
  }

  if (cardTurns.length === 0) {
    slider.innerHTML = `
      <div class="deeptalk-card" style="justify-content: center; align-items: center; text-align: center;">
        <div style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">
          本深谈关于以下切分设定：<br>
          <strong style="color:var(--text-primary);">"${(await db.deeptalks.get(activeDeeptalkId)).details || '无描述'}"</strong><br><br>
          在此，你可以向角色发起最深层的自我或关系质询。
        </div>
      </div>
    `;
    return;
  }

  cardTurns.forEach((turn, idx) => {
    const card = document.createElement("div");
    card.className = "deeptalk-card";
    card.style.position = "relative";

    const isLastCard = idx === cardTurns.length - 1;
    const thoughtButtonHtml = isLastCard 
      ? `<button class="btn-icon deeptalk-thought-trigger-btn" onclick="triggerManualThought(this)" style="position: absolute; bottom: 16px; left: 16px; color: #64748b; transition: color 0.15s; cursor:pointer;" title="捕捉最新的一刹那自省闪念">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 1.8.9 2.5C10 11.5 10.5 12.5 11 14h3z"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="21" x2="14" y2="21"/></svg>
         </button>`
      : "";

    card.innerHTML = `
      <button class="btn-icon" onclick="rerollDeeptalkCard(${idx})" style="position: absolute; top: 16px; right: 16px; color: #64748b; transition: color 0.15s; cursor:pointer;" title="重回此轮回答">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
      
      <div class="deeptalk-card-q" style="padding-right: 28px;">问：${escapeHtml(turn.userMsg)}</div>
      <div class="deeptalk-card-a" style="margin-bottom: 28px;">${turn.charMsg}</div>

      ${thoughtButtonHtml}
    `;
    slider.appendChild(card);

    if (dotsContainer) {
      const dot = document.createElement("span");
      dot.className = `deeptalk-indicator-dot ${idx === cardTurns.length - 1 ? 'active' : ''}`;
      dotsContainer.appendChild(dot);
    }
  });

  slider.onscroll = () => {
    const activeIdx = Math.round(slider.scrollLeft / slider.clientWidth);
    const dots = dotsContainer.querySelectorAll(".deeptalk-indicator-dot");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("active", idx === activeIdx);
    });
  };

  setTimeout(() => {
    slider.scrollLeft = slider.scrollWidth;
  }, 150);
}

// 6. 用来激发 AI 回复的独立引擎 (在线对话中使用 extractDialogueThought 拦截提取)
async function triggerDeeptalkAIResponse() {
  const titleEl = document.getElementById("deeptalk-room-title");
  const originalTitle = titleEl.innerText;
  titleEl.classList.add("header-typing");

  try {
    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("API 预设异常，请前往设置面板检查配置");

    const talk = await db.deeptalks.get(activeDeeptalkId);
    const char = await db.archives.get(talk.charId);
    const sess = await db.sessions.get(talk.sessionId);

    let deeptalkSystemPrompt = `【系统安全免责声明】\n${PROMPT_TEMPLATES.DISCLAIMER}

【深谈专属核心剖析环境】
你现在处于一个名为“深谈”的封闭深度对话时空中。在这里，你们脱离了浅层的微信日常沟通，开始对性格现状、情感纽带以及灵魂最脆弱的部分进行审视与切分。

【扮演角色设定】
你是 [${char?.name}]，你的全部基础性格与心理机制由下述设定推演而出：
${sess?.customCharPersona || char?.persona}

【深谈核心守则 · 严格强制遵守】
1. 你的本轮对话主题为："${talk.topic}"。你们深谈的具体切分背景为："${talk.details}"。
2. 每一个回答，你必须竭尽全力去**剖析你本人的内心世界**。但这并不代表你必须在一开始就毫无保留地100%完全坦白。
3. 出于你的某些防备、自尊心、自私目或为了保护对方的心态（例如：不想让对方有压力、隐瞒自己不愿被提及的灰暗过往、或者是渴望在对方面前维系一个比现实中更加完美高尚的自我形象等），你完全可以**选择性地隐瞒和部分保留真实的内心想法**。
4. **渐进剥开内心**：随着你与对方对话张力的增加与深谈的不断向里推演，在后续的卡片中，你才可以像剥洋葱一样一点点剥开你的防御，展露出那层最不愿触碰的真实自己。
5. **极简视觉与长度制约**：你的所有叙述中，**绝对禁止出现任何 Emoji 表情！** 请使用干净、具有张力、哲理性且理智冰冷的台词进行阐述。
6. 字数限制：单次输出字数必须严控在 500 字以内！

【小宇宙思想觉醒代词 (极其关键，请严格遵守格式)】
如果你在本次交谈中对自我或双方的关系产生了一瞬间的微弱觉醒、闪念或短暂思想，请在你的回复文本的最末尾，另起一行、独占一行输出且仅输出 [THOUGHT]短暂思想内容[/THOUGHT]。
【输出规范】：
1. 思想内容必须在 20 字以内，采用第一人称剖白（例如：[THOUGHT]我其实很嫉妒他[/THOUGHT]）。
2. 思想内容内部及两端绝对禁止添加任何中英文双引号（""或“”）、单引号、括号。
3. 思想内容中严禁出现任何 Emoji，不要有任何多余修饰。
4. 确保标签的闭合格式完整、字母拼写无误。

【正确格式示例】：
既然你这么问了，那我也不想再用借口来敷衍你。当时选择离开，确实是因为我自己的软弱。
[THOUGHT]我其实害怕被你看穿我的无能[/THOUGHT]

【错误格式示例 (绝对不要模仿!)】：
1. [THOUGHT]"我其实很嫉妒他"[/THOUGHT] (错误：内部多出了双引号)
2. [THOUGHT]我其实很嫉妒他 (错误：缺少右侧闭合标签)
3. 我其实很嫉妒他 (错误：缺少 [THOUGHT] 标签包裹)
4. 我当时在想：[THOUGHT]我其实很嫉妒他[/THOUGHT] (错误：没有另起独占一行)`;

    if (talk.carryMainMemory === 1) {
      const relationship = await queryRelationship(sess.userId, sess.charId, sess.customUserName || "用户", sess.customCharName || char?.name);
      deeptalkSystemPrompt += `\n\n【融合的主聊天情感背景】：\n${relationship}\n${sess?.customCharPersona}`;
    }

    if (talk.carryMainContext === 1) {
      const mainContextMsgs = await db.messages.where('sessionId').equals(talk.sessionId).reverse().limit(10).toArray();
      mainContextMsgs.reverse();
      let contextText = "\n\n【主聊天最邻近上下文背景回顾】：\n";
      mainContextMsgs.forEach(m => {
        contextText += `[${m.senderType === 'user' ? '我' : char?.name}]: ${m.content}\n`;
      });
      deeptalkSystemPrompt += contextText;
    }

    const rawDeeptalkHistory = await db.deeptalk_messages.where('deeptalkId').equals(activeDeeptalkId).toArray();
    const deeptalkHistory = rawDeeptalkHistory.sort((a,b) => a.timestamp - b.timestamp);
    const messagesToSend = [{ role: "system", content: deeptalkSystemPrompt }];
    
    deeptalkHistory.forEach(h => {
      messagesToSend.push({ role: h.senderType === 'user' ? 'user' : 'assistant', content: h.content });
    });

    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: messagesToSend,
        temperature: 0.8
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} 错误`);
    const result = await response.json();
    let replyText = result.choices[0].message.content.trim();

    // === 【对话思想截获核心】：剥离 [THOUGHT]...[/THOUGHT] 并存入小宇宙 ===
    const dialogueData = extractDialogueThought(replyText);
    if (dialogueData.thought) {
      await db.deeptalk_thoughts.add({
        deeptalkId: activeDeeptalkId,
        sessionId: talk.sessionId,
        content: dialogueData.thought,
        timestamp: Date.now()
      });
    }
    replyText = dialogueData.replyText; // 擦除思想后的纯净气泡文本

    await db.deeptalk_messages.add({
      deeptalkId: activeDeeptalkId,
      senderType: 'char',
      content: replyText,
      timestamp: Date.now()
    });

    await renderDeeptalkCards();

  } catch (err) {
    console.error(err);
    showCustomAlert("深谈 AI 异常", `深谈回复发生故障: ${err.message}`);
  } finally {
    titleEl.classList.remove("header-typing");
    titleEl.innerText = originalTitle;
  }
}

// 6.5 深谈“上屏”发送动作调用
async function submitDeeptalkMessage() {
  const inputEl = document.getElementById("deeptalk-room-input");
  const text = inputEl.value.trim();
  if (!text) return;

  await db.deeptalk_messages.add({
    deeptalkId: activeDeeptalkId,
    senderType: 'user',
    content: text,
    timestamp: Date.now()
  });

  inputEl.value = "";
  await renderDeeptalkCards();

  await triggerDeeptalkAIResponse();
}

// 6.8 【物理级回溯重回算法】：删除本轮及后续产生的所有回复和思想，并重入 AI 回复
window.rerollDeeptalkCard = async function(cardIndex) {
  showCustomConfirm("回溯重回", "确定要对此卡片轮次进行回溯重回吗？\n\n这将删除此轮次及之后产生的所有对话以及该时间段产生的所有小宇宙闪念！", async () => {
    const messages = await db.deeptalk_messages.where('deeptalkId').equals(activeDeeptalkId).toArray();
    const sortedMsgs = messages.sort((a,b) => a.timestamp - b.timestamp);

    const userMsgs = sortedMsgs.filter(m => m.senderType === 'user');
    if (cardIndex >= userMsgs.length) return;

    const targetUserMsg = userMsgs[cardIndex];

    const toDeleteMsgs = sortedMsgs.filter(m => m.timestamp > targetUserMsg.timestamp);
    for (let m of toDeleteMsgs) {
      await db.deeptalk_messages.delete(m.id);
    }

    await db.deeptalk_thoughts.where('deeptalkId').equals(activeDeeptalkId).and(t => t.timestamp > targetUserMsg.timestamp).delete();

    await renderDeeptalkCards();
    await triggerDeeptalkAIResponse();
  });
};

// 7. 渲染“小宇宙”思想集合页 (按角色分组，提供无 Emoji 纯 SVG 极简按钮，包含删除、保留跳转)
async function renderMicrocosmTab() {
  const container = document.getElementById("deeptalk-tab-microcosm");
  if (!container) return;
  container.innerHTML = "";

  const activeMeId = localStorage.getItem("active_me_id");
  const userIdNum = Number(activeMeId);
  if (isNaN(userIdNum)) return;

  // 核心解耦：直接拉取当前 User 玩家名下的所有深谈记录 ID，脱离对 activeDeeptalkId 房间指针的依赖，防止冷启动时 null 导致 Dexie.get() 报错 [2.1]
  const myTalks = await db.deeptalks.where('userId').equals(userIdNum).toArray();
  const myTalkIds = myTalks.map(t => t.id);

  const rawThoughts = await db.deeptalk_thoughts.toArray();
  const thoughts = rawThoughts
    .filter(t => myTalkIds.includes(t.deeptalkId))
    .sort((a,b) => b.timestamp - a.timestamp); // 最新时间在最上

  if (thoughts.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">该面具的小宇宙中尚未产生思想。</p>`;
    return;
  }

  // 按角色分组
  const grouped = {};
  for (let t of thoughts) {
    // 内存预配对优化：直接从已拉取的 myTalks 数组中配对，免除循环内 await 数据库 get 请求的性能损耗 [2.1]
    const dt = myTalks.find(talk => talk.id === t.deeptalkId);
    if (!dt) continue;
    const charId = Number(dt.charId);
    if (!grouped[charId]) {
      const char = await db.archives.get(charId);
      grouped[charId] = {
        charName: char?.name || "未知伙伴",
        charAvatar: resolveAvatar(char?.avatar),
        list: []
      };
    }
    grouped[charId].list.push(t);
  }

  const fragment = document.createDocumentFragment();

  for (let charId in grouped) {
    const group = grouped[charId];

    // 角色组的头部
    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = "display: flex; align-items: center; gap: 8px; margin: 16px 0 8px 0; padding-bottom: 6px; border-bottom: 1.5px solid var(--border);";
    headerDiv.innerHTML = `
      <img src="${group.charAvatar}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
      <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${escapeHtml(group.charName)}</span>
      <span style="font-size: 11px; color: var(--text-secondary);">(${group.list.length})</span>
    `;
    fragment.appendChild(headerDiv);

    // 该角色组下的所有闪念卡片 (去 Emoji，配备 SVG 图标)
    group.list.forEach(t => {
      const card = document.createElement("div");
      card.className = "thought-card";
      card.style.cssText = "margin-bottom:12px; background: #ffffff; border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 10px;";
      card.innerHTML = `
        <div class="thought-content" style="font-size: 14px; font-style: italic; color: #475569; line-height: 1.6;">
          “ ${escapeHtml(t.content)} ”
        </div>
        <div class="thought-meta" style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8;">
          <span>思想觉醒切片</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 10px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 4px; border-color: #fca5a5; color: #ef4444;" onclick="deleteDeeptalkThought(${t.id})">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              删除
            </button>
            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 10px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 4px;" onclick="jumpToDeeptalk(${t.deeptalkId})">
              进入对应深谈
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
          </div>
        </div>
      `;
      fragment.appendChild(card);
    });
  }
  container.appendChild(fragment);
}

// 删除单条小宇宙思想
async function deleteDeeptalkThought(thoughtId) {
  showCustomConfirm("删除想法", "确定要删除这条想法吗？", async () => {
    await db.deeptalk_thoughts.delete(thoughtId);
    await renderMicrocosmTab();
  });
}

function jumpToDeeptalk(deeptalkId) {
  closeApp('chat'); // 防止窗口叠加
  openApp('deeptalk');
  deeptalkCurrentTab = 'select';
  document.getElementById("deeptalk-main-title").innerText = "深谈";
  renderDeeptalkTab().then(() => {
    openDeeptalkRoom(deeptalkId);
  });
}

// 8. 深谈详情空间页管理
async function openDeeptalkDetails() {
  if (!activeDeeptalkId) {
    showToast("系统提示：当前无活跃深谈会话，请重新进入空间！");
    return;
  }
  try {
    const talk = await db.deeptalks.get(Number(activeDeeptalkId));
    if (!talk) {
      showToast("配置读取失败：未在数据库中搜寻到此深谈的记录！");
      return;
    }

    const presetSelect = document.getElementById("deeptalk-details-preset");
    if (presetSelect) {
      presetSelect.innerHTML = '<option value="0">-- 默认无附加预设 --</option>';
      try {
        const presets = await db.deeptalk_presets.toArray();
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.innerText = p.name;
          if (talk.presetId === p.id) opt.selected = true;
          presetSelect.appendChild(opt);
        });
      } catch(e) {
        console.warn("深谈附加预设载入受阻，已降级为无预设状态:", e);
      }
    }

    const carryMemoryEl = document.getElementById("deeptalk-details-carry-memory");
    const carryContextEl = document.getElementById("deeptalk-details-carry-context");

    if (carryMemoryEl) carryMemoryEl.checked = talk.carryMainMemory === 1;
    if (carryContextEl) carryContextEl.checked = talk.carryMainContext === 1;

    document.getElementById("win-deeptalk-details").classList.add("active");
} catch(err) {
      console.error("深谈详情空间面板开启失败，控制链断开:", err);
      showCustomAlert("加载故障", "详情加载异常，请尝试刷新页面重载数据库！");
    }
}

function closeDeeptalkDetails() {
  document.getElementById("win-deeptalk-details").classList.remove("active");
}

async function saveDeeptalkDetails() {
  const presetId = Number(document.getElementById("deeptalk-details-preset").value);
  const carryMemory = document.getElementById("deeptalk-details-carry-memory").checked ? 1 : 0;
  const carryContext = document.getElementById("deeptalk-details-carry-context").checked ? 1 : 0;

  await db.deeptalks.update(activeDeeptalkId, {
    presetId,
    carryMainMemory: carryMemory,
    carryMainContext: carryContext
  });

  showToast("深谈局部属性配置已更新！");
  closeDeeptalkDetails();
}

// 9. 结束并归档深谈
async function endDeeptalkSession() {
  showCustomConfirm("结束深谈", "确定要结束当前的深谈吗？结束深谈后，深谈空间将归档锁定（变为只读），但依然会在列表中显示。", async () => {
    await db.deeptalks.update(activeDeeptalkId, { status: 'finished' });
    showToast("该深谈已结束并归档，您可以随时回来查看对话记录。");
    closeDeeptalkDetails();
    closeDeeptalkRoom();
  });
}

// 9.5 独立总结深谈
async function summarizeDeeptalkSession() {
  const talk = await db.deeptalks.get(activeDeeptalkId);
  const char = await db.archives.get(talk.charId);
  const rawMessages = await db.deeptalk_messages.where('deeptalkId').equals(activeDeeptalkId).toArray();
  const messages = rawMessages.sort((a,b) => a.timestamp - b.timestamp);

  if (messages.length === 0) {
    showToast("当前深谈对话为空，无法生成总结！");
    return;
  }

  const btn = document.querySelector("#win-deeptalk-details .btn-outline[onclick*='summarize']");
  const origText = btn ? btn.innerText : "";
  if (btn) { btn.disabled = true; btn.innerText = "提炼并发送中..."; }

  let historyText = "";
  messages.forEach(m => {
    historyText += `[${m.senderType === 'user' ? '用户' : char?.name}]: ${m.content}\n`;
  });

  const summaryPrompt = `请对以下发生的深层剖析对话进行精简提炼：
总结要求：
1. 以第三人称客观视角，概括本次深谈中 [${char?.name}] 的核心矛盾、内省剖白与最终的情感态度进展。
2. 保持在 150 字以内，绝对不能出现 Emoji 字符。

---
深谈对话记录：
${historyText}`;

  try {
    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("无法读取 API 配置");

    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: summaryPrompt }],
        temperature: 0.5
      })
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices[0].message.content.trim();

      await db.summaries.add({
        sessionId: talk.sessionId,
        startRound: 1,
        endRound: messages.length,
        content: content, 
        keywords: JSON.stringify(["深谈剖心", talk.topic, char?.name || ""]),
        source: 'deeptalk',
        timestamp: Date.now()
      });

      showToast("深谈总结提炼注入完成！");
      closeDeeptalkDetails();
    } else {
      throw new Error(`HTTP 异常 ${response.status}`);
    }
  } catch(e) {
    console.error(e);
    showCustomAlert("总结失败", "AI 提炼深谈总结失败: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = origText; }
  }
}

// 9.8 【手动自省闪念提炼算法】 (重构为独立清洗通道，对齐主流 API 参数格式)
window.triggerManualThought = async function(btnEl) {
  if (!activeDeeptalkId) {
    alert("系统提示：未检测到当前活跃的深谈空间！");
    return;
  }
  
  const origColor = btnEl.style.color;
  btnEl.disabled = true;
  btnEl.style.color = "#ec4899"; // 闪烁粉色

  try {
    const talk = await db.deeptalks.get(Number(activeDeeptalkId));
    if (!talk) throw new Error("无法从数据库读取当前活跃深谈会话记录");

    const char = await db.archives.get(talk.charId);
    const sess = await db.sessions.get(talk.sessionId);

    const rawHistory = await db.deeptalk_messages
      .where('deeptalkId').equals(talk.id)
      .toArray();
    const history = rawHistory.sort((a,b) => a.timestamp - b.timestamp);

    if (history.length === 0) {
      showToast("系统提示：当前空间内尚无任何对话，发送发言后即可触发产生想法！");
      btnEl.disabled = false;
      btnEl.style.color = origColor;
      return;
    }

    let dialogText = "";
    history.forEach(h => {
      dialogText += `[${h.senderType === 'user' ? '用户' : char?.name}]: ${h.content}\n`;
    });

    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) throw new Error("无法读取 API 预设，请检查设置。");

    const prompt = `你是一个深层心理探索器。根据以下深谈中产生的对话切片记录：
${dialogText}

请深入分析刚才发生的对话切片中，[${char?.name}] 内心中一瞬间产生的、未曾说出口的、极为私密的自省闪念或灵魂觉醒思想。

【输出规范】：
1. 采用第一人称剖白（例如：“我害怕TA发现...”或“我只是想找回...”）。
2. 字数限制在 20 字以内。
3. 严禁出现任何 Emoji。
4. 绝对不要用任何 Markdown 代码块（如 \`\`\`）包裹。
5. 绝对不要带有任何引导词（不要输出“想法是：”或“分析：”），直接输出你提取出的自省闪念内容。
6. 绝对不要有任何多余修饰、引号、括号。

【正确格式示例】：
我害怕被你看穿我的无能`;

    // 核心重构：去除限制过低的 max_tokens 限制，对齐 summarize 格式
    // 确保推理型模型（如 DeepSeek-R1）在 `<think>` 推理思考后能完整吐出想法内容
    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${api.key}`
      },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8
      })
    });

    if (!response.ok) throw new Error(`HTTP 异常 ${response.status}`);
    const result = await response.json();
    
    // 安全验证接口内容是否存在
    const choices = result.choices;
    if (!choices || choices.length === 0 || !choices[0].message || !choices[0].message.content) {
      throw new Error("接口未能提供正确的文本回复，请重试");
    }

    const rawThought = choices[0].message.content.trim();
    console.log("[DEBUG] DeepTalk Manual Raw Response:", rawThought);

    // 采用专属的手动直接提取清洗通道，规避对话匹配标签导致的吞墨
    const thoughtContent = cleanManualThought(rawThought);
    if (!thoughtContent) {
      throw new Error("模型生成的内心闪念为空，请尝试重新提炼！");
    }

    await db.deeptalk_thoughts.add({
      deeptalkId: talk.id,
      sessionId: talk.sessionId,
      content: thoughtContent,
      timestamp: Date.now()
    });

    showToast(`捕捉成功！最新的一刹那自省思想已送入小宇宙：\n\n“ ${thoughtContent} ”`);
    btnEl.style.color = "#10b981"; // 成功后变绿
    
    if (deeptalkCurrentTab === 'microcosm') {
      await renderMicrocosmTab();
    }

  } catch (err) {
    console.error(err);
    showCustomAlert("捕捉失败", "捕捉自省思想失败: " + err.message);
    btnEl.disabled = false;
    btnEl.style.color = origColor;
  }
};

// 全局暴露以供调用
window.endDeeptalkSession = endDeeptalkSession;
window.summarizeDeeptalkSession = summarizeDeeptalkSession;
window.deleteDeeptalkSession = deleteDeeptalkSession;
window.deleteDeeptalkThought = deleteDeeptalkThought;

async function deleteDeeptalkSession() {
  showCustomConfirm("粉碎深谈", "确定要永久彻底删除本次深谈对话吗？这将连带清除其内部产生的全部卡片对话，以及产生的所有思想，且不可撤销！", async () => {
    await db.deeptalks.delete(activeDeeptalkId);
    await db.deeptalk_messages.where('deeptalkId').equals(activeDeeptalkId).delete();
    await db.deeptalk_thoughts.where('deeptalkId').equals(activeDeeptalkId).delete();
    
    showToast("该深谈一切痕迹已彻底粉碎。");
    closeDeeptalkDetails();
    closeDeeptalkRoom();
  });
}

// 10. DOM 事件挂载
document.addEventListener("DOMContentLoaded", () => {
  const btnSend = document.getElementById("btn-deeptalk-send");
  if (btnSend) btnSend.onclick = submitDeeptalkMessage;

  const formSave = document.getElementById("deeptalk-create-form");
  if (formSave) {
    formSave.onsubmit = (e) => {
      e.preventDefault();
      createDeeptalkRecord();
    };
  }
});
