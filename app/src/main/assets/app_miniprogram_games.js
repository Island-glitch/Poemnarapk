/**
 * ============================================================
 * app_miniprogram_games.js - 内置小程序：真心话大冒险 + 情侣飞行棋
 * ------------------------------------------------------------
 * 设计原则：
 *   1. 完全无损挂载：仅在 miniProgramSystem 初始化后注册；
 *   2. UI 规范：禁止任何 emoji，所有按钮使用纯内联 SVG 图标；
 *   3. 聊天室式页面：所有玩家依次行动并由系统推进进度；
 *   4. 通过 MiniProgramAPI 调用 char 数据、主记忆、上下文与 LLM；
 *   5. 所有 API 调用显示「正在行动…」动效；
 *   6. 输入框为自由文本框 + SVG 发送图标按钮；
 *   7. 通过 api.onInvite 接收分享拉入的参与者。
 *   8. 分享前置：分享即「引入」，shared 标记持久化进 state；
 *   9. 结束机制：退出小程序不清 state（可随时回来继续），
 *      只有「结束本局」按钮才清除 state。
 * 依赖：window.miniProgramSystem（registerBuiltin / ICONS）
 * ============================================================
 */
(function () {
  "use strict";

  if (!window.miniProgramSystem || typeof window.miniProgramSystem.registerBuiltin !== "function") {
    console.warn("[MiniProgramGames] miniProgramSystem 未就绪，跳过内置小程序注册");
    return;
  }

  const ICONS = window.miniProgramSystem.ICONS;

  const SVG = {
    truth: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17.75l-6.16 3.73 1.64-7.03L2.5 9.25l7.19-.61L12 2l2.31 6.64 7.19.61-4.98 5.2 1.64 7.03z"/></svg>',
    chess: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V3"/><path d="M5 3h14"/><path d="M9 12v4a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-4"/><circle cx="12" cy="20" r="1"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    target: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>'
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 加载动效 HTML（"正在行动…"）
  function loadingHtml(text) {
    return `<div class="mp-loading-dots"><span></span><span></span><span></span></div><span>${esc(text || "正在行动…")}</span>`;
  }

  // ============================================================
  //  真心话大冒险
  // ============================================================
  function mountTruthOrDare(container, api) {
    let state = null;
    let busy = false;
    let loadingIdSeq = 0;
    const roomEl = container;
    const STATE_KEY = "tod_state";
    const HISTORY_LIMIT = 20; // 每次 LLM 调用至少携带 20 轮上下文

    // 默认「我」即玩家之一（无需手动加入），name 初始为「我」，mount 时异步读取真实用户名
    function defaultMe() {
      return { id: 0, name: "我", avatar: "", isMe: true, type: "user", persona: "" };
    }

    async function loadState() {
      state = api.loadState(STATE_KEY, null);
      if (!state) {
        state = { started: false, shared: false, players: [defaultMe()], round: 0, log: [] };
        saveState();
      }
      if (!state.players || !state.players.some(p => p.isMe)) {
        state.players = (state.players || []).concat([defaultMe()]);
      }
      // 异步读取当前用户的真实名字与人设，更新「我」的信息
      try {
        const user = await api.getActiveUser();
        if (user && user.name) {
          const me = state.players.find(p => p.isMe);
          if (me) {
            me.name = user.name;
            me.avatar = user.avatar || "";
            me.persona = user.persona || "";
            saveState();
          }
        }
      } catch (e) {}
    }
    function saveState() {
      if (!state) return;
      // _richCtx 仅是运行时缓存（含大段记忆/上下文），不持久化，避免撑爆 localStorage
      if (state._richCtx) {
        const tmp = state._richCtx;
        delete state._richCtx;
        api.saveState(STATE_KEY, state);
        state._richCtx = tmp;
      } else {
        api.saveState(STATE_KEY, state);
      }
    }

    // 注册分享拉入参与者回调（分享即「引入」，不依赖再次点击）
    api.onInvite = (newParticipants) => {
      if (!newParticipants || !newParticipants.length) return;
      newParticipants.forEach(p => {
        if (state.players.some(x => x.id === p.id && x.isMe === p.isMe)) return;
        state.players.push(p);
      });
      state.shared = true;
      const names = (newParticipants.map(p => p.name).join("、") || "新玩家");
      if (state.started) {
        // 已开始：立即结束本轮，开启新回合让新成员参与
        addSystemMsg(names + " 加入了房间，立即开启新一轮！");
        saveState();
        startNewRound(state.round + 1);
      } else {
        addSystemMsg(names + " 已加入本局。");
        saveState();
        render();
      }
    };

    function addSystemMsg(text) { state.log.push({ type: "system", text, id: ++loadingIdSeq }); saveState(); }
    function addMsg(who, text) { state.log.push({ type: "text", who, text, id: ++loadingIdSeq }); saveState(); }
    function addLongMsg(who, text) { state.log.push({ type: "long", who, text, id: ++loadingIdSeq }); saveState(); }
    function addDiceMsg(who, value) { state.log.push({ type: "dice", who, value, id: ++loadingIdSeq }); saveState(); }
    function addLoadingMsg(who, text) {
      const id = ++loadingIdSeq;
      state.log.push({ type: "loading", who, text, id });
      saveState();
      render();
      return id;
    }
    function resolveLoadingMsg(id, type, text) {
      const idx = state.log.findIndex(l => l.id === id);
      if (idx < 0) return;
      state.log[idx] = { type, who: state.log[idx].who, text, id };
      saveState();
      render();
    }

    // 拼接最近 HISTORY_LIMIT 条游戏记录作为 LLM 上下文（让 AI 明白谁提议/谁行动/谁平手）
    function buildHistory() {
      const recent = state.log.slice(-HISTORY_LIMIT);
      const hist = [];
      for (const it of recent) {
        if (it.type === "system") {
          hist.push({ role: "system", content: it.text });
        } else if (it.type === "text" || it.type === "long") {
          const isMe = it.who && it.who.isMe;
          hist.push({ role: isMe ? "user" : "assistant", content: (it.who ? it.who.name + "：" : "") + it.text });
        } else if (it.type === "dice") {
          hist.push({ role: "user", content: (it.who ? it.who.name : "?") + " 掷出 " + it.value + " 点" });
        }
      }
      return hist;
    }
    // 玩家与人设概览（供 prompt 让 AI 区分在场每个人）
    function playersRoster(exclude) {
      return state.players
        .filter(p => p !== exclude)
        .map(p => "- " + p.name + (p.isMe ? "（用户/我）" : "（角色）") + (p.persona ? "，人设：" + String(p.persona).slice(0, 200) : ""))
        .join("\n");
    }

    // 拉取每位 char 玩家的完整上下文（人设 + 主记忆 + 关系网 + 最近对话 + 总结），
    // 拼成详细 prompt 块注入每次 LLM 调用，让 AI 真正"认识"在场每个人。
    // 结果会缓存到 state._richCtx（按 charId 索引），避免每次调用都重复拉取。
    async function buildRichContextBlock() {
      const charPlayers = state.players.filter(p => !p.isMe && p.id && (p.id > 0 || p.isSnapshot));
      if (charPlayers.length === 0) return "";
      if (!state._richCtx) state._richCtx = {};
      const lines = [];
      for (const p of charPlayers) {
        // 已缓存且 persona 未变则复用
        const cached = state._richCtx[p.id];
        if (cached && cached.persona === p.persona) {
          lines.push(cached.block);
          continue;
        }
        try {
          const ctx = await api.getCharRichContext(p.id);
          if (!ctx) { lines.push("【" + p.name + "】人设摘要：" + (p.persona || "（未设定）").slice(0, 200)); continue; }
          const parts = [];
          parts.push("【" + ctx.name + "】");
          if (ctx.persona) parts.push("人设：" + String(ctx.persona).slice(0, 400));
          // 主记忆
          if (ctx.memory) {
            const m = ctx.memory;
            const memBits = [];
            if (m.coreSelfStatus) memBits.push("当前状态：" + String(m.coreSelfStatus).slice(0, 200));
            if (m.coreSelfPurpose) memBits.push("核心目的：" + String(m.coreSelfPurpose).slice(0, 200));
            if (m.coreSelfChanges) memBits.push("近期变化：" + String(m.coreSelfChanges).slice(0, 200));
            if (m.coreRelationship) memBits.push("与用户关系：" + String(m.coreRelationship).slice(0, 200));
            if (m.coreUserInEyes) memBits.push("眼中的用户：" + String(m.coreUserInEyes).slice(0, 200));
            if (m.latestSummary && m.latestSummary.content) memBits.push("最近总结：" + String(m.latestSummary.content).slice(0, 300));
            if (memBits.length) parts.push("主记忆：\n" + memBits.map(b => "  - " + b).join("\n"));
          }
          // 关系网（仅取涉及本房间其他成员的关系，避免噪音）
          if (ctx.network && ctx.network.length) {
            const roomIds = charPlayers.map(c => c.id).concat([0]);
            const rels = ctx.network.filter(r => roomIds.includes(r.fromId) || roomIds.includes(r.toId));
            if (rels.length) parts.push("关系网：\n" + rels.slice(0, 12).map(r => "  - " + (r.fromId === p.id ? "→" + r.toId : r.fromId + "→") + "：" + r.relation).join("\n"));
          }
          // 最近对话上下文（精简）
          if (ctx.recentContext && ctx.recentContext.length) {
            const ctxBits = ctx.recentContext.slice(-6).map(m => {
              const who = m.senderType === "user" ? "用户" : (ctx.name || "角色");
              return "  " + who + "：" + String(m.content || "").slice(0, 120);
            });
            parts.push("近期对话：\n" + ctxBits.join("\n"));
          }
          const block = parts.join("\n");
          state._richCtx[p.id] = { persona: p.persona, block: block };
          lines.push(block);
        } catch (e) {
          lines.push("【" + p.name + "】人设摘要：" + (p.persona || "（未设定）").slice(0, 200));
        }
      }
      return lines.length ? "=== 在场角色完整背景（人设/记忆/关系网/上下文） ===\n" + lines.join("\n\n") : "";
    }

    function render() {
      if (!state.started) renderSetup();
      else renderRoom();
    }

    function renderSetup() {
      roomEl.innerHTML = `
        <div class="mp-game-wrap">
          <div class="mp-game-statusbar" style="padding-top: env(safe-area-inset-top, 24px);">${SVG.book}<span>真心话大冒险 · 聊天室</span></div>
          <div class="mp-game-room" id="tod-room">
            <div class="mp-game-msg system">玩法：你默认是玩家之一。点击右上角胶囊「分享」拉入一个或多个 char 作为对手。每人掷骰判输赢，点数最小者为输家。</div>
            <div class="mp-game-msg system">真心话：赢家依次提问，输家回答；大冒险：赢家各提议一个，随机抽中后输家执行。行动完成后其余玩家会依次点评。退出可随时回来继续，点「结束本局」才会清掉当前进度。</div>
          </div>
          <div class="mp-game-actionbar">
            <button class="mp-game-btn" id="tod-start">${SVG.trophy}<span>开始本局</span></button>
            <button class="mp-game-btn outline" id="tod-end-setup">结束本局</button>
          </div>
        </div>
      `;
      const room = roomEl.querySelector("#tod-room");
      state.players.forEach((p) => {
        const div = document.createElement("div");
        div.className = "mp-game-msg " + (p.isMe ? "me" : "them");
        div.innerHTML = `<div class="mp-game-msg-author">${esc(p.name)}${p.isMe ? "（你）" : ""}</div><div>已加入本局</div>`;
        room.appendChild(div);
      });
      if (!state.shared) {
        const tip = document.createElement("div");
        tip.className = "mp-game-msg system";
        tip.textContent = "请先点击右上角胶囊「分享」拉入对手后再开始本局。";
        room.appendChild(tip);
      }
      roomEl.querySelector("#tod-start").onclick = () => {
        if (state.players.length < 2) { api.toast("请先分享拉入对手（至少 2 人）"); return; }
        if (!state.shared) { api.toast("请先分享拉入对手后再开始本局"); return; }
        startNewRound(1);
      };
      roomEl.querySelector("#tod-end-setup").onclick = async () => {
        const ok = await api.showConfirm("结束本局", "结束本局并清空当前进度？");
        if (!ok) return;
        api.clearState(STATE_KEY);
        api.close();
      };
    }

    function startNewRound(round) {
      const isGroup = state.players.filter(p => !p.isMe).length > 1;
      state.started = true;
      state.isGroup = isGroup;
      state.round = round;
      state.phase = "rolling";
      state.currentRollerIdx = 0;
      state.rolls = [];
      state.tieGroup = null;       // 平局重投者（不替换 players，修复「平手后其他人丢失」）
      state.loser = null;
      state.winners = [];
      state.truthQuestions = [];
      state.truthAnswered = false;
      state.dareProposals = [];
      state.dareFinal = null;
      state.dareFinalDone = false;
      state.commented = false;
      saveState();
      addSystemMsg("第 " + round + " 局开始！按顺序掷骰子，点数最小者为输家。");
      render();
      maybeAutoRoll();
    }

    function actorBanner() {
      let txt = "";
      if (state.phase === "rolling") {
        const cur = rollQueue()[state.currentRollerIdx];
        txt = "轮到 " + (cur ? esc(cur.name) : "?") + " 掷骰子" + (state.tieGroup ? "（平局重投）" : "");
      } else if (state.phase === "choosing") {
        txt = "输家：" + esc(state.loser ? state.loser.name : "?") + " · 请选择真心话或大冒险";
      } else if (state.phase === "truth-asking") {
        const idx = state.truthQuestions.findIndex(q => !q.text);
        if (idx >= 0) txt = "轮到 " + esc(state.truthQuestions[idx].from.name) + " 向输家 " + esc(state.loser.name) + " 提问";
        else txt = "等待输家 " + esc(state.loser.name) + " 回答";
      } else if (state.phase === "dare-proposing") {
        const idx = state.dareProposals.findIndex(d => !d.text);
        if (idx >= 0) txt = "轮到 " + esc(state.dareProposals[idx].from.name) + " 提议大冒险";
        else txt = "准备抽取最终大冒险";
      } else if (state.phase === "dare-final") {
        txt = "输家 " + esc(state.loser.name) + " 正在执行大冒险";
      } else if (state.phase === "commenting") {
        txt = "其余玩家正在点评…";
      } else if (state.phase === "finished") {
        txt = "第 " + state.round + " 局结束";
      }
      return `<div class="mp-actor-banner">${SVG.target}<span>${txt}</span></div>`;
    }

    // 当前掷骰队列：平局重投时只让平局者掷，其余玩家保留
    function rollQueue() { return state.tieGroup || state.players; }

    function renderRoom() {
      const isMyTurn = state.phase === "rolling" && rollQueue()[state.currentRollerIdx] && rollQueue()[state.currentRollerIdx].isMe;
      const isMyChoice = state.phase === "choosing" && state.loser && state.loser.isMe;
      const isMyTruthAsk = state.phase === "truth-asking" && (() => {
        const idx = state.truthQuestions.findIndex(q => !q.text);
        return idx >= 0 && state.truthQuestions[idx].from.isMe;
      })();
      const isMyDarePropose = state.phase === "dare-proposing" && (() => {
        const idx = state.dareProposals.findIndex(d => !d.text);
        return idx >= 0 && state.dareProposals[idx].from.isMe;
      })();
      const waitingMyAnswer = state.phase === "truth-asking" && state.loser && state.loser.isMe && !state.truthQuestions.some(q => !q.text) && !state.truthAnswered;
      const waitingMyDareDo = state.phase === "dare-final" && state.loser && state.loser.isMe && !state.dareFinalDone;

      let actionbar = "";
      if (state.phase === "rolling") {
        const cur = rollQueue()[state.currentRollerIdx];
        actionbar = `<button class="mp-game-btn" id="tod-roll" ${isMyTurn ? "" : "disabled"}>${ICONS.dice}<span>${isMyTurn ? "我掷骰子" : "等待 " + esc(cur ? cur.name : "")}</span></button>`;
      } else if (state.phase === "choosing") {
        actionbar = isMyChoice
          ? `<button class="mp-game-btn" id="tod-pick-truth">${SVG.truth}<span>真心话</span></button><button class="mp-game-btn outline" id="tod-pick-dare">${SVG.trophy}<span>大冒险</span></button>`
          : `<button class="mp-game-btn" disabled>等待 ${esc(state.loser ? state.loser.name : "")} 选择…</button>`;
      } else if (state.phase === "truth-asking") {
        if (isMyTruthAsk) {
          actionbar = `<textarea class="mp-game-textarea" id="tod-truth-input" placeholder="向输家 ${esc(state.loser ? state.loser.name : "")} 提问…"></textarea><button class="mp-send-icon-btn" id="tod-truth-send">${SVG.send}</button>`;
        } else if (waitingMyAnswer) {
          actionbar = `<textarea class="mp-game-textarea" id="tod-answer-input" placeholder="回答所有问题…"></textarea><button class="mp-send-icon-btn" id="tod-answer-send">${SVG.send}</button>`;
        } else {
          actionbar = `<button class="mp-game-btn" disabled>正在行动…</button>`;
        }
      } else if (state.phase === "dare-proposing") {
        if (isMyDarePropose) {
          actionbar = `<textarea class="mp-game-textarea" id="tod-dare-input" placeholder="向输家 ${esc(state.loser ? state.loser.name : "")} 提议大冒险…"></textarea><button class="mp-send-icon-btn" id="tod-dare-send">${SVG.send}</button>`;
        } else {
          actionbar = `<button class="mp-game-btn" disabled>正在行动…</button>`;
        }
      } else if (state.phase === "dare-final") {
        if (waitingMyDareDo) {
          actionbar = `<textarea class="mp-game-textarea" id="tod-dare-do-input" placeholder="描述你执行大冒险的过程…"></textarea><button class="mp-send-icon-btn" id="tod-dare-do-send">${SVG.send}</button>`;
        } else if (!state.dareFinalDone) {
          actionbar = `<button class="mp-game-btn" id="tod-dare-roll">${ICONS.dice}<span>随机抽取最终大冒险</span></button>`;
        } else {
          actionbar = `<button class="mp-game-btn" disabled>正在行动…</button>`;
        }
      } else if (state.phase === "finished") {
        actionbar = `<button class="mp-game-btn" id="tod-next">${SVG.trophy}<span>开始下一局</span></button><button class="mp-game-btn outline" id="tod-end">结束本局</button>`;
      }

      roomEl.innerHTML = `
        <div class="mp-game-wrap">
          ${actorBanner()}
          <div class="mp-game-room" id="tod-room"></div>
          <div class="mp-game-actionbar">${actionbar}</div>
        </div>
      `;
      const room = roomEl.querySelector("#tod-room");
      state.log.forEach(item => {
        const d = document.createElement("div");
        if (item.type === "system") {
          d.className = "mp-game-msg system";
          d.innerHTML = esc(item.text);
        } else if (item.type === "loading") {
          d.className = "mp-game-msg loading";
          d.innerHTML = loadingHtml(item.text);
        } else if (item.type === "dice") {
          d.className = "mp-game-msg " + (item.who.isMe ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who.name)}</div><div class="mp-dice-row"><div class="mp-dice">${item.value}</div><div class="mp-dice-row-name">掷出 ${item.value} 点</div></div>`;
        } else if (item.type === "text") {
          d.className = "mp-game-msg " + (item.who.isMe ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who.name)}</div><div>${esc(item.text)}</div>`;
        } else if (item.type === "long") {
          d.className = "mp-game-msg " + (item.who.isMe ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who.name)}</div><div class="mp-game-msg-long">${esc(item.text)}</div>`;
        }
        room.appendChild(d);
      });
      room.scrollTop = room.scrollHeight;
      bindRoomActions();
    }

    function bindRoomActions() {
      const rollBtn = roomEl.querySelector("#tod-roll");
      if (rollBtn) rollBtn.onclick = () => doRoll();
      const pickTruth = roomEl.querySelector("#tod-pick-truth");
      if (pickTruth) pickTruth.onclick = () => doPick("truth");
      const pickDare = roomEl.querySelector("#tod-pick-dare");
      if (pickDare) pickDare.onclick = () => doPick("dare");

      const truthSend = roomEl.querySelector("#tod-truth-send");
      if (truthSend) truthSend.onclick = () => {
        const input = roomEl.querySelector("#tod-truth-input");
        const txt = (input && input.value || "").trim();
        if (!txt) { api.toast("请输入问题"); return; }
        const idx = state.truthQuestions.findIndex(q => !q.text);
        if (idx >= 0) {
          state.truthQuestions[idx].text = txt;
          addMsg(state.truthQuestions[idx].from, "问：" + txt);
          maybeAskTruth();
        }
      };
      const answerSend = roomEl.querySelector("#tod-answer-send");
      if (answerSend) answerSend.onclick = () => {
        const inp = roomEl.querySelector("#tod-answer-input");
        const ans = (inp && inp.value || "").trim();
        if (!ans) { api.toast("请输入回答"); return; }
        addLongMsg(state.loser, ans);
        state.truthAnswered = true;
        saveState();
        runCommentary("truth");
      };
      const dareSend = roomEl.querySelector("#tod-dare-send");
      if (dareSend) dareSend.onclick = () => {
        const input = roomEl.querySelector("#tod-dare-input");
        const txt = (input && input.value || "").trim();
        if (!txt) { api.toast("请输入大冒险"); return; }
        const idx = state.dareProposals.findIndex(d => !d.text);
        if (idx >= 0) {
          state.dareProposals[idx].text = txt;
          addMsg(state.dareProposals[idx].from, "提议大冒险：" + txt);
          maybeProposeDare();
        }
      };
      const dareRoll = roomEl.querySelector("#tod-dare-roll");
      if (dareRoll) dareRoll.onclick = () => doDareFinal();
      const dareDoSend = roomEl.querySelector("#tod-dare-do-send");
      if (dareDoSend) dareDoSend.onclick = () => {
        const inp = roomEl.querySelector("#tod-dare-do-input");
        const ans = (inp && inp.value || "").trim();
        if (!ans) { api.toast("请描述你的执行"); return; }
        addLongMsg(state.loser, ans);
        state.dareFinalDone = true;
        saveState();
        runCommentary("dare");
      };
      const nextBtn = roomEl.querySelector("#tod-next");
      if (nextBtn) nextBtn.onclick = () => startNewRound(state.round + 1);
      const endBtn = roomEl.querySelector("#tod-end");
      if (endBtn) endBtn.onclick = async () => {
        const ok = await api.showConfirm("结束本局", "结束本局并清空当前进度？退出小程序则可随时回来继续。");
        if (!ok) return;
        api.clearState(STATE_KEY);
        api.close();
      };
    }

    async function doRoll() {
      if (busy || state.phase !== "rolling") return;
      const queue = rollQueue();
      const roller = queue[state.currentRollerIdx];
      if (!roller) return;
      busy = true;
      const val = Math.floor(Math.random() * 6) + 1;
      addDiceMsg(roller, val);
      state.rolls.push({ who: roller, value: val });
      state.currentRollerIdx++;
      saveState();
      render();
      busy = false;
      if (state.currentRollerIdx >= queue.length) {
        let min = Infinity;
        state.rolls.forEach(r => { if (r.value < min) min = r.value; });
        const tied = state.rolls.filter(r => r.value === min);
        if (tied.length > 1) {
          // 关键修复：平局只让平局者重投，绝不替换 players，其余玩家保留
          addSystemMsg("出现平局（" + tied.map(l => l.who.name).join("、") + "），平局者重新掷骰，其余玩家保留。");
          state.tieGroup = tied.map(l => l.who);
          state.currentRollerIdx = 0;
          state.rolls = [];
          saveState();
          render();
          maybeAutoRoll();
          return;
        }
        state.loser = tied[0].who;
        state.winners = state.players.filter(p => p !== state.loser);
        state.tieGroup = null;
        addSystemMsg("本局输家是 " + state.loser.name + "！赢家：" + state.winners.map(w => w.name).join("、"));
        state.phase = "choosing";
        saveState();
        render();
        if (!state.loser.isMe) {
          setTimeout(() => doPick(Math.random() < 0.5 ? "truth" : "dare"), 900);
        }
      } else {
        maybeAutoRoll();
      }
    }

    function maybeAutoRoll() {
      const cur = rollQueue()[state.currentRollerIdx];
      if (cur && !cur.isMe && state.phase === "rolling") {
        setTimeout(() => doRoll(), 800);
      }
    }

    function doPick(choice) {
      if (state.phase !== "choosing") return;
      addMsg(state.loser, "我选择" + (choice === "truth" ? "真心话" : "大冒险"));
      if (choice === "truth") {
        state.phase = "truth-asking";
        state.truthQuestions = state.winners.map(w => ({ from: w, text: "" }));
        state.truthAnswered = false;
        addSystemMsg("赢家依次向输家 " + state.loser.name + " 提问。");
        saveState();
        render();
        maybeAskTruth();
      } else {
        state.phase = "dare-proposing";
        state.dareProposals = state.winners.map(w => ({ from: w, text: "" }));
        state.dareFinalDone = false;
        addSystemMsg("赢家各提出一个大冒险行动，随后随机抽取。");
        saveState();
        render();
        maybeProposeDare();
      }
    }

    // 多人提问/提议：一次性为所有 char 赢家生成内容（JSON 数组），避免逐个调用导致格式错乱
    // （学习 commentary 的做法：用 callLLM + 显式 messages，不依赖 getCharReply 的 history 角色混用）
    async function maybeAskTruth() {
      // 找出需要生成问题的 char 赢家（非我、尚未填入问题）
      const charWinners = state.truthQuestions.filter(q => !q.from.isMe && !q.text);
      if (charWinners.length > 0) {
        const lid = addLoadingMsg({ isMe: false, name: "赢家" }, "赢家们正在想问题…");
        try {
          const richCtx = await buildRichContextBlock();
          const roster = charWinners.map(w => "- " + w.from.name + "，人设：" + (w.from.persona || "（未设定）").slice(0, 200)).join("\n");
          const reply = await api.callLLM({
            messages: [
              { role: "system", content: "你负责为多人真心话大冒险生成「赢家提问」。下面给出每位赢家角色的完整背景（人设/记忆/关系网/上下文），请严格按每人性格分别给出一个真心话问题（每人 1-2 句话），用 JSON 数组返回，形如 [{\"name\":\"角色名\",\"question\":\"问题\"}]，不要输出任何额外文字。问题要符合各人设与语气，结合他们之间的关系与记忆，互不重复，不要用套路化内容。" },
              { role: "user", content: (richCtx ? richCtx + "\n\n" : "") + "输家是：" + state.loser.name + "。\n需要提问的赢家：\n" + roster + "\n\n请按每人个性分别给出一个真心话问题，返回 JSON 数组。" }
            ],
            temperature: 0.85
          });
          let questions = [];
          try {
            const m = reply.match(/\[[\s\S]*\]/);
            questions = m ? JSON.parse(m[0]) : [];
          } catch (e) { questions = []; }
          for (const q of charWinners) {
            const found = questions.find(x => x && x.name === q.from.name);
            q.text = (found && found.question) ? String(found.question).trim() : "你最近一次心动是什么时候？";
            addMsg(q.from, "问：" + q.text);
          }
          resolveLoadingMsg(lid, "system", "赢家已提问。");
        } catch (e) {
          addSystemMsg("（赢家提问 API 调用失败，已用默认题兜底）");
          for (const q of charWinners) {
            q.text = "你最近一次说谎是什么时候？";
            addMsg(q.from, "问：" + q.text);
          }
          resolveLoadingMsg(lid, "system", "（提问失败，使用默认题）");
        }
      }
      // 检查是否有「我」需要手动提问
      const myQ = state.truthQuestions.find(q => q.from.isMe && !q.text);
      if (myQ) {
        render();
        return; // 等待用户输入
      }
      // 所有问题已就绪 → 进入回答
      maybeAnswerTruth();
    }

    async function maybeAnswerTruth() {
      if (state.truthAnswered) return;
      if (state.truthQuestions.some(q => !q.text)) return;
      if (state.loser.isMe) {
        state.truthAnswered = false;
        render();
        return;
      }
      state.truthAnswered = true;
      saveState();
      const questions = state.truthQuestions.map((q, i) => (i + 1) + ". " + q.text).join("\n");
      const lid = addLoadingMsg(state.loser, state.loser.name + " 正在认真回答…");
      try {
        const richCtx = await buildRichContextBlock();
        const reply = await api.getCharReply({
          charId: (state.loser.id > 0 || state.loser.isSnapshot) ? state.loser.id : undefined,
          persona: state.loser.persona || undefined,
          history: buildHistory(),
          prompt: "你是真心话大冒险的输家(" + state.loser.name + ")。赢家依次向你提了以下问题：\n" + questions + "\n\n在场的其他玩家：\n" + playersRoster(state.loser) + (richCtx ? "\n\n" + richCtx : "") + "\n\n请以你自身角色身份，依次如实、生动地回答每个问题。结合你与提问者之间的关系和过往记忆来回答，不要说教，符合你的人设与语气。不要硬性截断，可以尽情展开。",
          systemPrompt: "你正在玩真心话大冒险并输了。必须如实、生动地回答赢家提出的所有问题，符合你的人设与性格，结合你与在场各位的关系与记忆，不要说教或拒绝。"
        });
        resolveLoadingMsg(lid, "long", (reply && reply.trim() ? reply : "（沉默）").trim());
      } catch (e) {
        addSystemMsg("（" + state.loser.name + " 的回答 API 调用失败）");
        resolveLoadingMsg(lid, "text", "（避而不答）");
      }
      runCommentary("truth");
    }

    async function maybeProposeDare() {
      // 找出需要生成大冒险的 char 赢家（非我、尚未填入提议）
      const charWinners = state.dareProposals.filter(d => !d.from.isMe && !d.text);
      if (charWinners.length > 0) {
        const lid = addLoadingMsg({ isMe: false, name: "赢家" }, "赢家们正在想大冒险…");
        try {
          const richCtx = await buildRichContextBlock();
          const roster = charWinners.map(w => "- " + w.from.name + "，人设：" + (w.from.persona || "（未设定）").slice(0, 200)).join("\n");
          const reply = await api.callLLM({
            messages: [
              { role: "system", content: "你负责为多人真心话大冒险生成「赢家大冒险提议」。下面给出每位赢家角色的完整背景（人设/记忆/关系网/上下文），请严格按每人性格分别给出一个大冒险行动描述（每人 1-2 句话），用 JSON 数组返回，形如 [{\"name\":\"角色名\",\"proposal\":\"行动描述\"}]，不要输出任何额外文字。行动要贴合各人设与个性，结合他们与输家之间的关系和过往记忆，互不重复，禁止「学猫叫/唱首歌/做俯卧撑」之类套路化内容，要有创意且符合角色关系。" },
              { role: "user", content: (richCtx ? richCtx + "\n\n" : "") + "输家是：" + state.loser.name + "。\n需要提议的赢家：\n" + roster + "\n\n请按每人个性分别给出一个大冒险行动，返回 JSON 数组。" }
            ],
            temperature: 0.85
          });
          let proposals = [];
          try {
            const m = reply.match(/\[[\s\S]*\]/);
            proposals = m ? JSON.parse(m[0]) : [];
          } catch (e) { proposals = []; }
          for (const d of charWinners) {
            const found = proposals.find(x => x && x.name === d.from.name);
            d.text = (found && found.proposal) ? String(found.proposal).trim() : "即兴表演一个符合自己人设的小剧场";
            addMsg(d.from, "提议大冒险：" + d.text);
          }
          resolveLoadingMsg(lid, "system", "赢家已提议。");
        } catch (e) {
          addSystemMsg("（赢家提议 API 调用失败，已用默认兜底）");
          for (const d of charWinners) {
            d.text = "即兴表演一个符合自己人设的小剧场";
            addMsg(d.from, "提议大冒险：" + d.text);
          }
          resolveLoadingMsg(lid, "system", "（提议失败，使用默认兜底）");
        }
      }
      // 检查是否有「我」需要手动提议
      const myD = state.dareProposals.find(d => d.from.isMe && !d.text);
      if (myD) {
        render();
        return; // 等待用户输入
      }
      // 所有提议已就绪 → 抽取最终大冒险
      state.phase = "dare-final";
      addSystemMsg("所有赢家已提议，现在随机抽取一个作为最终大冒险。");
      saveState();
      render();
      if (!state.loser.isMe) {
        setTimeout(() => doDareFinal(), 900);
      }
    }

    async function doDareFinal() {
      if (state.phase !== "dare-final" || state.dareFinalDone) return;
      const proposals = state.dareProposals.filter(d => d.text);
      if (!proposals.length) { api.toast("没有可用的提议"); return; }
      const picked = proposals[Math.floor(Math.random() * proposals.length)];
      addSystemMsg("随机抽中 " + picked.from.name + " 的提议：" + picked.text);
      state.dareFinal = picked;
      saveState();
      if (state.loser.isMe) {
        state.dareFinalDone = false;
        render();
        return;
      }
      state.dareFinalDone = true;
      saveState();
      const lid = addLoadingMsg(state.loser, state.loser.name + " 正在执行大冒险…");
      try {
        const richCtx = await buildRichContextBlock();
        const reply = await api.getCharReply({
          charId: (state.loser.id > 0 || state.loser.isSnapshot) ? state.loser.id : undefined,
          persona: state.loser.persona || undefined,
          history: buildHistory(),
          prompt: "你是真心话大冒险的输家(" + state.loser.name + ")。赢家(" + picked.from.name + ")提出的行动被随机抽中，你必须执行：「" + picked.text + "」\n\n在场的其他玩家：\n" + playersRoster(state.loser) + (richCtx ? "\n\n" + richCtx : "") + "\n\n请以你自身角色身份，生动、细致地描写你执行这个大冒险的过程。结合你与提议者及在场各位的关系和过往记忆，包含动作、神态、对白与心理。不要说教，符合人设。不要硬性截断，可以尽情展开。",
          systemPrompt: "你正在玩真心话大冒险并输了，必须执行被抽中的大冒险行动。请输出线下文本，描写你执行的过程，包含动作、神态、对白与心理，符合你的人设，结合你与在场各位的关系与记忆。不要硬性截断，可以尽情展开。"
        });
        resolveLoadingMsg(lid, "long", (reply && reply.trim() ? reply : "（沉默执行）").trim());
      } catch (e) {
        addSystemMsg("（" + state.loser.name + " 执行大冒险 API 调用失败）");
        resolveLoadingMsg(lid, "text", "（避而不执行）");
      }
      runCommentary("dare");
    }

    // 行动后点评：让 AI 读取在场所有非输家 char 的人设，按每人个性一次返回所有人反应并分开上屏
    async function runCommentary(kind) {
      if (state.commented) { finishRound(); return; }
      const spectators = state.players.filter(p => !p.isMe && p !== state.loser);
      if (spectators.length === 0) { state.commented = true; finishRound(); return; }
      state.phase = "commenting";
      saveState();
      render();
      const actionDesc = kind === "dare"
        ? "输家 " + state.loser.name + " 刚执行了大冒险：" + (state.dareFinal ? state.dareFinal.text : "")
        : "输家 " + state.loser.name + " 刚回答了真心话。";
      const roster = spectators.map(p => "- " + p.name + "，人设：" + (p.persona || "（未设定）").slice(0, 200)).join("\n");
      const lid = addLoadingMsg({ isMe: false, name: "众人" }, "众人正在点评…");
      try {
        const richCtx = await buildRichContextBlock();
        const reply = await api.callLLM({
          messages: [
            { role: "system", content: "你负责为多人真心话大冒险生成「旁观者点评」。下面给出每位旁观 char 的完整背景（人设/记忆/关系网/上下文），请严格按每人性格分别给出一句简短点评（每人 30-80 字），用 JSON 数组返回，形如 [{\"name\":\"角色名\",\"comment\":\"点评\"}]，不要输出任何额外文字。点评要结合他们与输家之间的关系和过往记忆。" },
            { role: "user", content: (richCtx ? richCtx + "\n\n" : "") + "场景：" + actionDesc + "\n\n需要点评的旁观者：\n" + roster + "\n\n请按每人个性分别给出点评，返回 JSON 数组。" }
          ],
          temperature: 0.85
        });
        let comments = [];
        try {
          const m = reply.match(/\[[\s\S]*\]/);
          comments = m ? JSON.parse(m[0]) : [];
        } catch (e) { comments = []; }
        resolveLoadingMsg(lid, "system", "众人点评：");
        for (const p of spectators) {
          const c = comments.find(x => x && x.name === p.name);
          addLongMsg(p, c ? c.comment : "（看着，没有说话）");
        }
      } catch (e) {
        addSystemMsg("（众人点评 API 调用失败）");
        resolveLoadingMsg(lid, "system", "（众人沉默）");
      }
      state.commented = true;
      finishRound();
    }

    function finishRound() {
      state.phase = "finished";
      addSystemMsg("第 " + state.round + " 局结束。");
      saveState();
      render();
    }

    loadState().then(() => render());
    // 退出小程序不清除对局状态：用户可随时重新点进来继续；只有「结束本局」按钮才清 state
    return function cleanup() {};
  }

  // ============================================================
  //  情侣飞行棋
  // ============================================================
  function mountCoupleChess(container, api) {
    const TOTAL_CELLS = 20;
    let state = null;
    let busy = false;
    let loadingIdSeq = 0;
    const roomEl = container;
    const BANK_KEY = "mp_couple_chess_banks";
    const STATE_KEY = "cc_state";

    function loadBanks() {
      try { return JSON.parse(localStorage.getItem(BANK_KEY)) || []; }
      catch (e) { return []; }
    }
    function saveBanks(banks) { localStorage.setItem(BANK_KEY, JSON.stringify(banks)); }
    function loadState() {
      state = api.loadState(STATE_KEY, null);
      if (!state) state = { started: false, shared: false, pendingChar: null, activeBankId: null, log: [] };
    }
    function saveState() { if (state) api.saveState(STATE_KEY, state); }

    // 分享拉入：一对一，新 char 替换当前对手。分享即「引入」，shared/pendingChar 持久化
    api.onInvite = (newParticipants) => {
      const ch = newParticipants && newParticipants.find(p => !p.isMe);
      if (!ch) return;
      state.shared = true;
      state.pendingChar = ch;
      if (state.started) {
        state.charName = ch.name; state.charId = ch.id; state.charPersona = ch.persona || "";
        addSystemMsg("对手切换为 " + ch.name + "，继续对局。");
        saveState();
        render();
      } else {
        saveState();
        api.toast("已拉入 " + ch.name + "，点击开始对局");
        render();
      }
    };

    function genBoard() {
      const cells = [];
      cells.push({ type: "start", label: "起点", delta: 0 });
      for (let i = 1; i < TOTAL_CELLS - 1; i++) {
        const r = Math.random();
        if (r < 0.18) cells.push({ type: "forward", label: "前进" + (Math.floor(Math.random() * 2) + 2), delta: Math.floor(Math.random() * 2) + 2 });
        else if (r < 0.30) cells.push({ type: "backward", label: "后退" + (Math.floor(Math.random() * 2) + 2), delta: -(Math.floor(Math.random() * 2) + 2) });
        else cells.push({ type: "question", label: "题", delta: 0 });
      }
      cells.push({ type: "end", label: "终点", delta: 0 });
      return cells;
    }

    function addSystemMsg(text) { state.log.push({ type: "system", text, id: ++loadingIdSeq }); saveState(); }
    function addMsg(who, text) { state.log.push({ type: "text", who, text, id: ++loadingIdSeq }); saveState(); }
    function addLongMsg(who, text) { state.log.push({ type: "long", who, text, id: ++loadingIdSeq }); saveState(); }
    function addDiceMsg(who, value) { state.log.push({ type: "dice", who, value, id: ++loadingIdSeq }); saveState(); }
    function addLoadingMsg(who, text) {
      const id = ++loadingIdSeq;
      state.log.push({ type: "loading", who, text, id });
      saveState();
      render();
      return id;
    }
    function resolveLoadingMsg(id, type, text) {
      const idx = state.log.findIndex(l => l.id === id);
      if (idx < 0) return;
      state.log[idx] = { type, who: state.log[idx].who, text, id };
      saveState();
      render();
    }

    function render() {
      if (!state.started) renderSetup();
      else renderRoom();
    }

    function renderSetup() {
      const banks = loadBanks();
      const activeId = state.activeBankId;
      const bankListHtml = banks.length === 0
        ? `<div class="mp-question-bank-item"><span class="mp-question-bank-name">暂无题库，请上传或新建</span></div>`
        : banks.map(b => `
          <div class="mp-question-bank-item ${activeId === b.id ? "active" : ""}">
            <span class="mp-question-bank-name">${esc(b.name)}（${b.questions.length} 题）</span>
            <div class="mp-question-bank-actions">
              <button class="mp-ws-icon-btn" data-act="use" data-id="${b.id}" title="选用">${SVG.check}</button>
              <button class="mp-ws-icon-btn danger" data-act="del" data-id="${b.id}" title="删除">${ICONS.trash}</button>
            </div>
          </div>`).join("");

      const pendingName = state.pendingChar ? state.pendingChar.name : null;
      roomEl.innerHTML = `
        <div class="mp-game-wrap">
          <div class="mp-game-statusbar">${SVG.chess}<span>情侣飞行棋 · 一对一·线下模式</span></div>
          <div class="mp-game-room" id="cc-room">
            <div class="mp-game-msg system">玩法：一对一·线下模式，默认在同一空间。轮流掷骰前进，先到终点者胜。赛道有「前进/后退/题」格，题目来自题库。</div>
            <div class="mp-game-msg system">落到「题」格时由对方出题，回答方以线下文本回应。须先点击右上角胶囊「分享」拉入对方，再开始对局。退出可随时回来继续，点「结束本局」才会清掉当前进度。</div>
            ${pendingName ? `<div class="mp-game-msg system">已拉入对手：${esc(pendingName)}</div>` : ""}
          </div>
          <div class="mp-game-actionbar" style="flex-direction:column; gap:10px; align-items:stretch;">
            <div class="mp-question-bank-list" id="cc-bank-list">${bankListHtml}</div>
            <div id="cc-paste-card-wrap"></div>
            <div style="display:flex; gap:8px;">
              <button class="mp-game-btn outline" id="cc-upload">${SVG.upload}<span>上传题库</span></button>
              <button class="mp-game-btn outline" id="cc-new-paste">${SVG.plus}<span>新建并粘贴</span></button>
              <button class="mp-game-btn" id="cc-start">${SVG.trophy}<span>开始对局</span></button>
            </div>
            <button class="mp-game-btn outline" id="cc-end-setup">结束本局</button>
          </div>
          <input type="file" id="cc-file" accept=".txt,text/plain" style="display:none;">
        </div>
      `;

      roomEl.querySelectorAll(".mp-question-bank-item button").forEach(btn => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          const id = btn.dataset.id;
          if (btn.dataset.act === "use") {
            state.activeBankId = id;
            saveState();
            api.toast("已选用该题库");
            render();
          } else if (btn.dataset.act === "del") {
            (async () => {
              const ok = await api.showConfirm("删除题库", "确定删除该题库？");
              if (ok) {
                saveBanks(loadBanks().filter(b => b.id !== id));
                render();
              }
            })();
          }
        };
      });

      const fileInput = roomEl.querySelector("#cc-file");
      roomEl.querySelector("#cc-upload").onclick = () => fileInput.click();
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const questions = String(ev.target.result || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (!questions.length) { api.toast("题库为空"); return; }
          const banks = loadBanks();
          const id = "bank_" + Date.now().toString(36);
          banks.push({ id, name: file.name.replace(/\.txt$/i, ""), questions });
          saveBanks(banks);
          state.activeBankId = id;
          saveState();
          api.toast("题库已上传并选用");
          render();
        };
        reader.readAsText(file);
        e.target.value = "";
      };

      roomEl.querySelector("#cc-new-paste").onclick = () => {
        const wrap = roomEl.querySelector("#cc-paste-card-wrap");
        if (wrap.dataset.shown === "1") { wrap.innerHTML = ""; wrap.dataset.shown = ""; return; }
        wrap.dataset.shown = "1";
        wrap.innerHTML = `
          <div class="mp-bank-paste-card">
            <input id="cc-paste-name" placeholder="题库名称（如：暧昧话题）">
            <textarea id="cc-paste-text" placeholder="一行一个题目，直接粘贴文本…&#10;例：&#10;你最心动的一瞬间？&#10;描述对方的一个小习惯&#10;说出一句想对ta说的话"></textarea>
            <div style="display:flex; gap:8px;">
              <button class="mp-game-btn" id="cc-paste-save">${SVG.check}<span>保存并选用</span></button>
              <button class="mp-game-btn outline" id="cc-paste-cancel">取消</button>
            </div>
          </div>
        `;
        roomEl.querySelector("#cc-paste-cancel").onclick = () => { wrap.innerHTML = ""; wrap.dataset.shown = ""; };
        roomEl.querySelector("#cc-paste-save").onclick = () => {
          const name = (roomEl.querySelector("#cc-paste-name").value || "").trim() || ("题库_" + new Date().toLocaleDateString());
          const text = roomEl.querySelector("#cc-paste-text").value || "";
          const questions = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (!questions.length) { api.toast("请至少输入一个题目"); return; }
          const banks = loadBanks();
          const id = "bank_" + Date.now().toString(36);
          banks.push({ id, name, questions });
          saveBanks(banks);
          state.activeBankId = id;
          saveState();
          api.toast("题库已保存并选用");
          render();
        };
      };

      // 开始对局：必须先分享拉入对手
      roomEl.querySelector("#cc-start").onclick = async () => {
        const banks = loadBanks();
        const active = state.activeBankId ? banks.find(b => b.id === state.activeBankId) : null;
        if (!active || !active.questions.length) { api.toast("请先上传/新建并选用题库"); return; }
        if (!state.shared || !state.pendingChar) { api.toast("请先点击右上角「分享」拉入对手后再开始对局"); return; }
        const ch = state.pendingChar;
        state = {
          started: true,
          shared: true,
          pendingChar: ch,
          activeBankId: active.id,
          bankName: active.name,
          questions: active.questions.slice(),
          board: genBoard(),
          mePos: 0, charPos: 0,
          turn: "me", round: 1, phase: "rolling",
          log: [],
          charName: ch.name, charId: ch.id, charPersona: ch.persona || "",
          currentQuestion: null, questionTarget: null,
          boardCollapsed: false
        };
        saveState();
        addSystemMsg("对局开始！你先掷骰子。");
        render();
      };

      roomEl.querySelector("#cc-end-setup").onclick = async () => {
        const ok = await api.showConfirm("结束本局", "结束本局并清空当前进度？");
        if (!ok) return;
        api.clearState(STATE_KEY);
        api.close();
      };
    }

    function renderRoom() {
      const showBoard = state.phase === "rolling" || state.phase === "finished" || state.phase === "question";
      // 棋盘可收起
      const boardCollapsed = !!state.boardCollapsed;
      const boardToggleHtml = showBoard
        ? `<div class="mp-board-toggle-row"><button class="mp-board-toggle-btn" id="cc-board-toggle">${boardCollapsed ? (SVG.plus || "") + "<span>展开棋盘</span>" : (SVG.check || "") + "<span>收起棋盘</span>"}</button></div>`
        : "";
      let actionbar = "";
      // 结束本轮 / 结束本局 合并为一个「更多」图标按钮，点击后弹出卡片选择
      const moreIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>';
      const endBtn = `<button class="mp-send-icon-btn" id="cc-more" title="结束本轮/本局">${moreIcon}</button>`;
      if (state.phase === "rolling") {
        if (state.turn === "me") actionbar = `<button class="mp-game-btn" id="cc-roll">${ICONS.dice}<span>我掷骰子</span></button>${endBtn}`;
        else actionbar = `<button class="mp-game-btn" disabled>等待 ${esc(state.charName)} 掷骰…</button>${endBtn}`;
      } else if (state.phase === "question") {
        // 题目阶段：输入框始终可用，双方持续交替行动，点「结束本轮」才进入下一轮投骰
        const placeholder = state.questionTarget === "me"
          ? "回答问题，或继续互动…"
          : "继续回应 " + esc(state.charName) + "…";
        actionbar = `<textarea class="mp-game-textarea" id="cc-answer-input" placeholder="${placeholder}"></textarea><button class="mp-send-icon-btn" id="cc-answer-send">${SVG.send}</button>${endBtn}`;
      } else if (state.phase === "finished") {
        actionbar = `<button class="mp-game-btn" id="cc-restart">${SVG.trophy}<span>再来一局</span></button>${endBtn}`;
      }

      roomEl.innerHTML = `
        <div class="mp-game-wrap">
          ${actorBannerCc()}
          ${boardToggleHtml}
          ${showBoard && !boardCollapsed ? renderBoard() : ""}
          <div class="mp-game-room" id="cc-room"></div>
          <div class="mp-game-actionbar">${actionbar}</div>
        </div>
      `;
      const room = roomEl.querySelector("#cc-room");
      state.log.forEach(item => {
        const d = document.createElement("div");
        if (item.type === "system") { d.className = "mp-game-msg system"; d.innerHTML = esc(item.text); }
        else if (item.type === "loading") { d.className = "mp-game-msg loading"; d.innerHTML = loadingHtml(item.text); }
        else if (item.type === "dice") {
          d.className = "mp-game-msg " + (item.who === "me" ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who === "me" ? "我" : state.charName)}</div><div class="mp-dice-row"><div class="mp-dice">${item.value}</div><div class="mp-dice-row-name">掷出 ${item.value} 点</div></div>`;
        } else if (item.type === "text") {
          d.className = "mp-game-msg " + (item.who === "me" ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who === "me" ? "我" : state.charName)}</div><div>${esc(item.text)}</div>`;
        } else if (item.type === "long") {
          d.className = "mp-game-msg " + (item.who === "me" ? "me" : "them");
          d.innerHTML = `<div class="mp-game-msg-author">${esc(item.who === "me" ? "我" : state.charName)}</div><div class="mp-game-msg-long">${esc(item.text)}</div>`;
        }
        room.appendChild(d);
      });
      room.scrollTop = room.scrollHeight;
      bindRoomActions();
    }

    function actorBannerCc() {
      let txt = "";
      if (state.phase === "rolling") txt = state.turn === "me" ? "轮到你掷骰子" : "轮到 " + esc(state.charName) + " 掷骰子";
      else if (state.phase === "question") txt = "题目环节 · 持续交替互动，点「结束本轮」进入下一轮投骰";
      else if (state.phase === "finished") txt = "对局结束";
      return `<div class="mp-actor-banner">${SVG.target}<span>第 ${state.round} 轮 · ${txt}</span></div>`;
    }

    function renderBoard() {
      const cells = state.board;
      const legend = `<div class="mp-board-legend">
        <span class="mp-board-legend-item"><span class="mp-board-legend-dot" style="background:#ffe0b2;"></span>起点</span>
        <span class="mp-board-legend-item"><span class="mp-board-legend-dot" style="background:#ffcdd2;"></span>终点</span>
        <span class="mp-board-legend-item"><span class="mp-board-legend-dot" style="background:#c8e6c9;"></span>前进</span>
        <span class="mp-board-legend-item"><span class="mp-board-legend-dot" style="background:#ffcdd2;"></span>后退</span>
        <span class="mp-board-legend-item"><span class="mp-board-legend-dot" style="background:#bbdefb;"></span>题</span>
        <span class="mp-board-legend-item"><span class="mp-board-pawn" style="position:static;"></span>我</span>
        <span class="mp-board-legend-item"><span class="mp-board-pawn me" style="position:static;"></span>${esc(state.charName)}</span>
      </div>`;
      const cellsHtml = cells.map((c, i) => {
        const cls = "mp-board-cell " + c.type + (i === state.mePos || i === state.charPos ? " current" : "");
        const mePawn = i === state.mePos ? `<span class="mp-board-pawn"></span>` : "";
        const charPawn = i === state.charPos ? `<span class="mp-board-pawn me"></span>` : "";
        return `<div class="${cls}" title="第 ${i} 格：${esc(c.label)}"><span class="mp-board-cell-no">${i}</span><span>${esc(c.label)}</span>${mePawn}${charPawn}</div>`;
      }).join("");
      return `<div class="mp-board-wrap"><div class="mp-board-track">${cellsHtml}</div>${legend}</div>`;
    }

    function bindRoomActions() {
      const rollBtn = roomEl.querySelector("#cc-roll");
      if (rollBtn) rollBtn.onclick = () => doRoll();
      const answerSend = roomEl.querySelector("#cc-answer-send");
      if (answerSend) answerSend.onclick = () => {
        const inp = roomEl.querySelector("#cc-answer-input");
        const ans = (inp && inp.value || "").trim();
        if (!ans) { api.toast("请输入内容"); return; }
        addLongMsg("me", ans);
        if (inp) inp.value = "";
        // 用户发言后让 char 回应（交替行动，不结束本轮）
        maybeCharRespond();
      };
      // 棋盘收起/展开
      const boardToggle = roomEl.querySelector("#cc-board-toggle");
      if (boardToggle) boardToggle.onclick = () => {
        state.boardCollapsed = !state.boardCollapsed;
        saveState();
        render();
      };
      // 「更多」按钮：点击弹出卡片选择「结束本轮」或「结束本局」
      const moreBtn = roomEl.querySelector("#cc-more");
      if (moreBtn) moreBtn.onclick = async () => {
        const opts = [{ label: "结束本轮", value: "round" }, { label: "结束本局", value: "game", danger: true }];
        const choice = await api.showActionCard("请选择操作", opts);
        if (choice === "round") {
          if (busy) { api.toast("正在行动，请稍候"); return; }
          if (state.phase === "question") {
            addSystemMsg("已手动结束本轮题目。");
            finishQuestion();
          } else if (state.phase === "rolling") {
            addSystemMsg((state.turn === "me" ? "我" : state.charName) + " 跳过本轮掷骰。");
            switchTurn();
          }
        } else if (choice === "game") {
          const ok = await api.showConfirm("结束本局", "结束本局并清空当前进度？退出小程序则可随时回来继续。");
          if (!ok) return;
          api.clearState(STATE_KEY);
          api.close();
        }
      };
      const restartBtn = roomEl.querySelector("#cc-restart");
      if (restartBtn) restartBtn.onclick = () => {
        const banks = loadBanks();
        const active = state.activeBankId ? banks.find(b => b.id === state.activeBankId) : null;
        state = {
          started: true,
          shared: true,
          pendingChar: state.pendingChar,
          activeBankId: state.activeBankId,
          bankName: active ? active.name : state.bankName,
          questions: active ? active.questions.slice() : state.questions,
          board: genBoard(),
          mePos: 0, charPos: 0,
          turn: "me", round: 1, phase: "rolling",
          log: [],
          charName: state.charName, charId: state.charId, charPersona: state.charPersona,
          currentQuestion: null, questionTarget: null,
          boardCollapsed: false
        };
        saveState();
        addSystemMsg("新对局开始！你先掷骰子。");
        render();
      };
    }

    async function doRoll() {
      if (busy || state.phase !== "rolling") return;
      busy = true;
      const who = state.turn;
      const val = Math.floor(Math.random() * 6) + 1;
      addDiceMsg(who, val);
      let newPos = (who === "me" ? state.mePos : state.charPos) + val;
      if (newPos >= TOTAL_CELLS) newPos = TOTAL_CELLS - 1;
      if (who === "me") state.mePos = newPos; else state.charPos = newPos;
      saveState();
      render();
      const cell = state.board[newPos];
      addSystemMsg((who === "me" ? "我" : state.charName) + " 落到第 " + newPos + " 格：" + cell.label);

      if (cell.type === "forward" || cell.type === "backward") {
        let p = (who === "me" ? state.mePos : state.charPos) + cell.delta;
        if (p < 0) p = 0;
        if (p >= TOTAL_CELLS) p = TOTAL_CELLS - 1;
        if (who === "me") state.mePos = p; else state.charPos = p;
        addSystemMsg((cell.delta > 0 ? "前进" : "后退") + "至第 " + p + " 格");
        saveState();
        render();
        if (checkFinish()) { busy = false; return; }
        busy = false;
        switchTurn();
        return;
      }
      if (cell.type === "question") {
        const target = who;
        state.phase = "question";
        state.questionTarget = target;
        state.currentQuestion = null;
        addSystemMsg("落到「题」格！从题库抽题，" + (target === "me" ? "你" : state.charName) + " 回答。");
        saveState();
        render();
        busy = false;
        // 不管是谁跳到，都从题库抽题（不再让玩家手填出题）
        await autoAskQuestion();
        return;
      }
      if (checkFinish()) { busy = false; return; }
      busy = false;
      switchTurn();
    }

    async function autoAskQuestion() {
      try {
        if (state.questions && state.questions.length) {
          const q = state.questions[Math.floor(Math.random() * state.questions.length)];
          state.currentQuestion = q;
          addMsg("char", "题：" + q);
          saveState();
          render();
          if (state.questionTarget === "me") {
            // 等待用户回答（输入框已在 renderRoom 里渲染）
          } else {
            await autoAnswerQuestion();
          }
        }
      } catch (e) {
        addSystemMsg("出题失败，跳过本题。");
        finishQuestion();
      }
    }

    // char 回答问题（带人设直传，不依赖 archives 查询，避免 API 失败）
    async function autoAnswerQuestion() {
      const lid = addLoadingMsg("char", state.charName + " 正在回答…");
      try {
        const reply = await api.getCharReply({
          charId: (state.charId && state.charId > 0) ? state.charId : undefined,
          persona: state.charPersona || undefined,
          prompt: "你正在和伴侣玩情侣飞行棋，落到了「题」格。对方问你：「" + state.currentQuestion + "」\n\n请以你自身角色身份，生动、细致地回答这个问题。包含动作、神态、对白与心理，不要说教，符合人设。不要硬性截断，可以尽情展开。",
          systemPrompt: "你正在玩情侣飞行棋并落到题目格。必须如实、生动地回答对方的问题，输出线下文本，包含动作、神态、对白与心理，符合你的人设。不要硬性截断，可以尽情展开。"
        });
        resolveLoadingMsg(lid, "long", (reply && reply.trim() ? reply : "（避而不答）").trim());
        // 回答后不自动结束本轮，也不自动追加 char 回应（否则会双重 char 回复）。
        // 直接回到用户输入框，由用户继续交替互动；点「结束本轮」才进入下一轮投骰。
        render();
      } catch (e) {
        addSystemMsg("（" + state.charName + " 的回答 API 调用失败）");
        resolveLoadingMsg(lid, "text", "（避而不答）");
        render();
      }
    }

    // char 对用户上一条发言做出回应（交替行动，不结束本轮）
    async function maybeCharRespond() {
      const lid = addLoadingMsg("char", state.charName + " 正在回应…");
      try {
        const recent = state.log.slice(-6).map(it => {
          if (it.type === "text" || it.type === "long") {
            return (it.who === "me" ? "我" : state.charName) + "：" + it.text;
          }
          return null;
        }).filter(Boolean).join("\n");
        const reply = await api.getCharReply({
          charId: (state.charId && state.charId > 0) ? state.charId : undefined,
          persona: state.charPersona || undefined,
          prompt: "你们正在玩情侣飞行棋的「题」格环节，可以持续交替互动。最近的对话：\n" + recent + "\n\n请以你自身角色身份，自然地回应对方。包含动作、神态、对白与心理，符合人设。不要硬性截断，可以尽情展开。",
          systemPrompt: "你正在玩情侣飞行棋的题目环节，和伴侣持续互动。以你自身角色身份自然回应，包含动作、神态、对白与心理，符合你的人设。"
        });
        resolveLoadingMsg(lid, "long", (reply && reply.trim() ? reply : "（沉默）").trim());
        // 回应后回到用户输入（不自动结束本轮）
        render();
      } catch (e) {
        addSystemMsg("（" + state.charName + " 的回应 API 调用失败）");
        resolveLoadingMsg(lid, "text", "（沉默）");
        render();
      }
    }

    function finishQuestion() {
      state.phase = "rolling";
      state.currentQuestion = null;
      state.questionTarget = null;
      saveState();
      addSystemMsg("本轮题目结束，唤出棋盘，由另一方行动。");
      render();
      switchTurn();
    }

    function switchTurn() {
      if (state.phase !== "rolling") return;
      state.turn = state.turn === "me" ? "char" : "me";
      state.round++;
      saveState();
      render();
      if (state.turn === "char") setTimeout(() => doRoll(), 900);
    }

    function checkFinish() {
      if (state.mePos >= TOTAL_CELLS - 1) {
        state.phase = "finished";
        addSystemMsg("你赢了！到达终点。");
        saveState();
        render();
        return true;
      }
      if (state.charPos >= TOTAL_CELLS - 1) {
        state.phase = "finished";
        addSystemMsg(state.charName + " 赢了！到达终点。");
        saveState();
        render();
        return true;
      }
      return false;
    }

    loadState();
    render();
    // 退出小程序不清除对局状态：用户可随时重新点进来继续；只有「结束本局」按钮才清 state
    return function cleanup() {};
  }

  // ============================================================
  //  注册内置小程序
  // ============================================================
  function registerAll() {
    window.miniProgramSystem.registerBuiltin({
      builtinKey: "truth_or_dare",
      name: "真心话大冒险",
      description: "聊天室式真心话大冒险，支持单聊/群聊拉入多 char，掷骰判输赢，长文本大冒险，行动后众人点评",
      version: "1.2.0",
      author: "叙事诗小手机",
      type: "game",
      iconSvg: SVG.truth
    }, mountTruthOrDare);

    window.miniProgramSystem.registerBuiltin({
      builtinKey: "couple_chess",
      name: "情侣飞行棋",
      description: "一对一·线下模式飞行棋，赛道随机布置前进/后退/题格，支持上传/粘贴题库",
      version: "1.2.0",
      author: "叙事诗小手机",
      type: "game",
      iconSvg: SVG.chess
    }, mountCoupleChess);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerAll);
  } else {
    registerAll();
  }
})();
