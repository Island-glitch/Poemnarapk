/**
 * app_workbench_agent.js - 工作台 Agent 引擎（独立文件，从 app_workbench.js 拆分）
 *
 * 对标市面 Agent 工作台（Claude / Cursor / Trae）的成熟 Agent 模式：
 * - 思考折叠块（Thought for X seconds）
 * - 工具调用卡片状态机（执行中 → 完成/失败，可折叠查看参数与结果）
 * - Markdown 完成渲染（runAgent 结束时 _finalize）
 * - 无工具循环次数限制（agent 自主决定，统计轮数/步数）
 * - 发送按钮进行中状态（点击中断）
 * - Agent / Skill 标准化配置（db.wb_agents / db.wb_skills）
 * - MCP 支持 http / streamable_http / sse 三种传输
 * - 输入框右侧加号按钮：配置 Agent 与 MCP
 * - 输入框 @ 引用工作区文件携带发送
 */
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  // ---- 过滤工具标签（避免"爆代码"） ----
  function wbStripToolTag(t) {
    return String(t || '').replace(/\[\s*WB_TOOL\s*:\s*\{[\s\S]*?\}\s*\]/gi, '').trim();
  }
  WB._stripToolTag = wbStripToolTag;

  // ---- 缓存命中率文本 ----
  WB._usageText = function (conv) {
    var txt = '↑' + (conv.totalTokensIn || 0) + ' ↓' + (conv.totalTokensOut || 0);
    var hit = conv.cacheHits || 0;
    var total = conv.totalTokensIn || 0;
    if (hit > 0 && total > 0) {
      var pct = Math.min(100, Math.round(hit / total * 100));
      txt += ' 缓存命中 ' + pct + '%';
    }
    if (conv.lastLoops || conv.lastSteps) {
      txt += ' · 本轮' + (conv.lastLoops || 0) + '轮' + (conv.lastSteps || 0) + '步';
    }
    return txt;
  };
  WB.updateChatHeader = function (conv) {
    var usageEl = document.getElementById('wb-usage');
    if (usageEl) usageEl.textContent = WB._usageText(conv);
  };

  // ---- 思考折叠块 + Markdown + Artifacts ----
  WB.renderAssistantContent = function (full, container, t0) {
    var self = this;
    var raw = String(full || '');
    // 先剥离 WB_TOOL 标签（历史回显/流式都统一，避免"爆代码"）
    raw = wbStripToolTag(raw);
    var thinks = raw.match(/<think>([\s\S]*?)<\/think>/g) || [];
    var cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    var html = '';
    var secs = t0 ? Math.round((Date.now() - t0) / 1000) : 0;
    var thinkLabel = secs > 1 ? ('Thought for ' + secs + ' seconds') : '思考过程';
    thinks.forEach(function (t) {
      var inner = t.replace(/<\/?think>/g, '').trim();
      var uid = 'wb-think-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      html += '<div class="wb-think-block" style="margin:6px 0;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;overflow:hidden;">' +
        '<div class="wb-think-head" data-uid="' + uid + '" style="display:flex;align-items:center;gap:6px;padding:8px 12px;cursor:pointer;user-select:none;">' +
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' +
          '<span style="flex:1;font-size:11px;font-weight:500;color:#64748b;">' + self.esc(thinkLabel) + '</span>' +
          '<svg class="wb-think-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</div>' +
        '<div class="wb-think-body" id="' + uid + '" style="display:none;border-top:1px solid #f1f5f9;padding:8px 12px;font-size:11px;line-height:1.6;color:#64748b;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow-y:auto;">' + self.esc(inner) + '</div>' +
      '</div>';
    });
    container.innerHTML = html + self.renderMarkdown(cleaned);
    container.querySelectorAll('.wb-think-head').forEach(function (h) {
      h.onclick = function () {
        var body = document.getElementById(h.getAttribute('data-uid'));
        if (!body) return;
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        var chev = h.querySelector('.wb-think-chev');
        if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
      };
    });
    // artifacts 代码块（保留原逻辑）
    var codeRe = /\x60\x60\x60([\w-]*)\n([\s\S]*?)\x60\x60\x60/g;
    var m;
    while ((m = codeRe.exec(cleaned))) {
      var lang = (m[1] || 'txt').toLowerCase();
      var code = m[2].replace(/\n$/, '');
      var idx = self.artifacts.push(lang, code);
      var card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:10px;margin:10px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.04);cursor:pointer;';
      card.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
        '<span style="flex:1;"><span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">' + self.esc('output.' + (lang || 'txt')) + '</span>' +
        '<span style="display:block;font-size:10px;color:#94a3b8;">' + (lang === 'html' || lang === 'svg' ? '点击打开预览' : '代码产出物') + '</span></span>' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
      card.setAttribute('class', 'wb-art-open');
      card.setAttribute('data-idx', String(idx));
      container.appendChild(card);
    }
    return container;
  };

  // ---- appendBubble：记录起始时间供思考时长，流式阶段由 runAgent 过滤 ----
  WB.appendBubble = function (role, text) {
    var self = this;
    var el = document.getElementById('wb-msgs');
    if (!el) return null;
    if (role === 'user') {
      var outer = document.createElement('div');
      outer.style.cssText = 'align-self:flex-end;display:flex;flex-direction:column;align-items:flex-end;max-width:88%;';
      var wrap = document.createElement('div');
      wrap.style.cssText = 'background:#f4f1ec;color:#1c1917;border-radius:16px 16px 4px 16px;padding:10px 14px;max-width:100%;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;';
      wrap.textContent = text || '';
      outer.appendChild(wrap);
      // 悬停操作条：复制 / 重新发送
      var actions = document.createElement('div');
      actions.style.cssText = 'display:none;align-items:center;gap:2px;margin-top:4px;';
      actions.innerHTML =
        '<button class="wb-msg-act" data-act="copy" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex;align-items:center;gap:3px;font-size:10px;" title="复制">' + this.svg('<path d="M8 8h12v12H8z"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', 11) + '复制</button>' +
        '<button class="wb-msg-act" data-act="resend" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex;align-items:center;gap:3px;font-size:10px;" title="重新发送">' + this.svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', 11) + '重新发送</button>';
      outer.appendChild(actions);
      el.appendChild(outer);
      wrap.addEventListener('click', function () {
        actions.style.display = actions.style.display === 'none' ? 'flex' : 'none';
      });
      var actBtns = actions.querySelectorAll('.wb-msg-act');
      actBtns.forEach(function (b) {
        var act = b.getAttribute('data-act');
        b.onclick = function (ev) {
          ev.stopPropagation();
          if (act === 'copy') {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text || '');
            else { try { var ta = document.createElement('textarea'); ta.value = text || ''; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (e) {} }
            if (typeof showToast === 'function') showToast('已复制');
          } else if (act === 'resend') {
            var convId = self.state.activeConvId;
            self.getConv(convId).then(function (conv) { if (conv && !self.state.sending) self.runAgent(conv, text || ''); });
          }
        };
      });
      this.scrollToBottom();
      return { _el: wrap };
    }
    var wrap2 = document.createElement('div');
    wrap2.style.cssText = 'align-self:stretch;display:flex;flex-direction:column;';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    head.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8m0 0 4-4m-4 4-4-4"/><path d="M12 10v12"/><path d="M20 15a8 8 0 0 1-16 0"/></svg><span style="font-size:11px;font-weight:600;color:#64748b;">工作台 Agent</span>';
    var content = document.createElement('div');
    content.style.cssText = 'font-size:13.5px;line-height:1.75;color:var(--text-primary);word-break:break-word;';
    var t0 = Date.now();
    wrap2.appendChild(head);
    wrap2.appendChild(content);
    el.appendChild(wrap2);
    this.scrollToBottom();
    return {
      _el: content,
      _finalize: function (full) {
        self.renderAssistantContent(full, content, t0);
        self.scrollToBottom();
      }
    };
  };

  // ---- 工具结果 → 卡片状态/内容（正式卡片与「流式升级卡」共用，避免两条路径行为不一致） ----
  function wbToolResultText(result) {
    var ok = !!(result && result.ok);
    if (!ok) return (result && result.error) || '未知错误';
    if (result.entries && Array.isArray(result.entries)) return '共 ' + result.entries.length + ' 项: ' + result.entries.map(function (en) { return en.name + (en.type === 'dir' ? '/' : ''); }).join(', ').slice(0, 1000);
    if (result.result !== undefined) return String(result.result).slice(0, 3000);
    if (result.content !== undefined) return String(result.content).slice(0, 3000);
    // fetch_url 等抓取类工具：正文优先（text），其次 raw body
    if (result.text !== undefined) {
      var head = 'HTTP ' + (result.status || 200) + (result.title ? ' · ' + result.title : '') + (result.jsRendered ? ' · 疑似 JS 动态渲染' : '') + '\n';
      return head + String(result.text).slice(0, 3000);
    }
    if (result.body !== undefined) return String(result.body).slice(0, 3000);
    if (result.summary !== undefined) return String(result.summary).slice(0, 3000);
    return result.message || '执行完成';
  }

  function wbApplyToolResult(self, card, result) {
    if (!card) return;
    var status = card.querySelector('.wb-tool-status');
    var box = card.querySelector('.wb-tool-result');
    var ok = !!(result && result.ok);
    if (status) {
      if (ok) {
        status.style.color = '#15803d';
        status.innerHTML = self.svg('<path d="M20 6 9 17l-5-5"/>', 11) + ' 完成';
      } else {
        status.style.color = '#dc2626';
        status.innerHTML = self.svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 11) + ' 失败';
      }
    }
    if (box) {
      box.textContent = wbToolResultText(result);
      box.style.color = ok ? '#475569' : '#b91c1c';
    }
    // 完成后把标题恢复为等宽字体（与正式卡片视觉一致）
    var nameEl = card.querySelector('.wb-tool-head > span:nth-child(2)');
    if (nameEl) nameEl.style.fontFamily = 'ui-monospace,monospace';
  }

  // ---- 工具调用卡片：Claude 风格状态机（执行中→完成/失败，可折叠） ----
  WB.appendToolCard = function (tool, args) {
    var self = this;
    var el = document.getElementById('wb-msgs');
    if (!el) return { _render: function () {} };
    var uid = 'wb-tc-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    var card = document.createElement('div');
    card.className = 'wb-tool-card';
    card.style.cssText = 'align-self:flex-start;width:92%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;flex-shrink:0;';
    card.innerHTML =
      '<div class="wb-tool-head" data-uid="' + uid + '" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;">' +
        '<span style="display:flex;align-items:center;gap:6px;color:#6366f1;flex-shrink:0;">' + self.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 13) + '</span>' +
        '<span style="flex:1;min-width:0;font-size:11px;font-weight:700;color:#334155;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.esc(tool) + '</span>' +
        '<span class="wb-tool-status" style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:#b45309;flex-shrink:0;">' +
          '<span class="wb-tool-spinner" style="width:10px;height:10px;border:1.5px solid #fbbf24;border-top-color:transparent;border-radius:50%;display:inline-block;animation:wbSpin 0.8s linear infinite;"></span>执行中…</span>' +
        '<svg class="wb-tool-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
      '</div>' +
      '<div class="wb-tool-body" style="display:none;border-top:1px solid #f1f5f9;padding:8px 12px;font-size:10px;color:#475569;max-height:280px;overflow-y:auto;">' +
        '<div style="font-weight:700;color:#94a3b8;margin-bottom:4px;">Arguments</div>' +
        '<pre style="margin:0 0 8px;padding:8px;background:#f8fafc;border-radius:8px;overflow-x:auto;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;">' + self.esc(JSON.stringify(args || {}, null, 2)) + '</pre>' +
        '<div style="font-weight:700;color:#94a3b8;margin-bottom:4px;">Response</div>' +
        '<pre class="wb-tool-result" style="margin:0;padding:8px;background:#f8fafc;border-radius:8px;overflow:auto;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;"></pre>' +
      '</div>';
    el.appendChild(card);
    var head = card.querySelector('.wb-tool-head');
    head.onclick = function () {
      var body = head.parentNode.querySelector('.wb-tool-body');
      if (!body) return;
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      var chev = head.querySelector('.wb-tool-chev');
      if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
    };
    if (!document.getElementById('wbSpinKey')) {
      var st = document.createElement('style');
      st.id = 'wbSpinKey';
      st.textContent = '@keyframes wbSpin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    this.scrollToBottom();
    return {
      _render: function (result) {
        wbApplyToolResult(self, card, result);
      },
      _card: card
    };
  };

  // ---- 实时工具调用占位卡片：流式阶段显示"正在调用工具"，点击可展开查看正在生成的代码流程 ----
  WB.appendToolPendingCard = function () {
    var self = this;
    var el = document.getElementById('wb-msgs');
    if (!el) return { _update: function () {}, _upgrade: function () {}, _fail: function () {} };
    var uid = 'wb-tp-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    var card = document.createElement('div');
    card.className = 'wb-tool-card';
    card.style.cssText = 'align-self:flex-start;width:92%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;flex-shrink:0;';
    card.innerHTML =
      '<div class="wb-tool-head" data-uid="' + uid + '" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;">' +
        '<span style="display:flex;align-items:center;gap:6px;color:#6366f1;flex-shrink:0;">' + self.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 13) + '</span>' +
        '<span style="flex:1;min-width:0;font-size:11px;font-weight:700;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">正在调用工具…</span>' +
        '<span class="wb-tool-status" style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:#6366f1;flex-shrink:0;">' +
          '<span class="wb-tool-spinner" style="width:10px;height:10px;border:1.5px solid #6366f1;border-top-color:transparent;border-radius:50%;display:inline-block;animation:wbSpin 0.8s linear infinite;"></span>执行中</span>' +
        '<svg class="wb-tool-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;transition:transform .15s;"><path d="M6 9l6 6 6-6"/></svg>' +
      '</div>' +
      '<div class="wb-tool-body" style="display:none;border-top:1px solid #f1f5f9;padding:8px 12px;font-size:10px;color:#475569;max-height:240px;overflow-y:auto;">' +
        '<div style="font-weight:700;color:#94a3b8;margin-bottom:4px;">正在生成的调用流程（实时）</div>' +
        '<pre class="wb-tp-stream" style="margin:0;padding:8px;background:#0f172a;border-radius:8px;overflow:auto;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:#e2e8f0;"></pre>' +
      '</div>';
    el.appendChild(card);
    var head = card.querySelector('.wb-tool-head');
    var body = card.querySelector('.wb-tool-body');
    var streamPre = card.querySelector('.wb-tp-stream');
    var expanded = false;
    head.onclick = function () {
      expanded = !expanded;
      body.style.display = expanded ? 'block' : 'none';
      var chev = head.querySelector('.wb-tool-chev');
      if (chev) chev.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
    };
    if (!document.getElementById('wbSpinKey')) {
      var st = document.createElement('style');
      st.id = 'wbSpinKey';
      st.textContent = '@keyframes wbSpin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    this.scrollToBottom();
    return {
      _update: function (rawText) {
        if (streamPre) streamPre.textContent = String(rawText || '');
      },
      _upgrade: function (tool, args) {
        // 升级为正式工具卡片：标题/Arguments/Response
        if (head) {
          var nameEl = head.querySelector('span:nth-child(2)');
          if (nameEl) nameEl.textContent = tool;
          var status = head.querySelector('.wb-tool-status');
          if (status) status.style.color = '#b45309';
        }
        if (body) {
          body.innerHTML =
            '<div style="font-weight:700;color:#94a3b8;margin-bottom:4px;">Arguments</div>' +
            '<pre style="margin:0 0 8px;padding:8px;background:#f8fafc;border-radius:8px;overflow-x:auto;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;">' + self.esc(JSON.stringify(args || {}, null, 2)) + '</pre>' +
            '<div style="font-weight:700;color:#94a3b8;margin-bottom:4px;">Response</div>' +
            '<pre class="wb-tool-result" style="margin:0;padding:8px;background:#f8fafc;border-radius:8px;overflow:auto;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;"></pre>';
        }
        // 升级后显式清空实时流原文（真实 DOM 中 body.innerHTML 已移除 stream 区；此处兜底防残留，
        // 避免占位卡片残留的 [WB_TOOL:...] 原文/代码进入消息正文，multitool 测试「正文不爆标签间代码」依赖此行为）
        if (streamPre) streamPre.textContent = '';
      },
      _fail: function (msg) {
        var status = head ? head.querySelector('.wb-tool-status') : null;
        if (status) {
          status.style.color = '#dc2626';
          status.innerHTML = self.svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 11) + ' 失败';
        }
        var box = card.querySelector('.wb-tool-result');
        if (box) {
          box.textContent = msg || '工具调用失败';
          box.style.color = '#b91c1c';
        } else if (streamPre) {
          streamPre.textContent = msg || '工具调用失败';
        }
      },
      // 关键：占位卡片被 _upgrade 复用为正式卡片后，必须同样能收到执行结果，
      // 否则状态会永远停在「执行中…」（此前该对象缺 _render，工具早已跑完却不更新状态）
      _render: function (result) {
        wbApplyToolResult(self, card, result);
      },
      _card: card
    };
  };

  // ---- runAgent：成熟 Agent 模式（无次数限制，agent 自主决定；统计轮数/步数；发送按钮进行中状态） ----
  WB.runAgent = async function (conv, userText) {
    var self = this;
    if (self.state.sending) return;
    self.state.sending = true;
    self._setSendBtnState(true);
    var preset = await self.getApiPreset();
    if (!preset || !preset.url || !preset.key) {
      self.appendSysMsg('未配置可用 API（请先在 设置-API 服务 中配置并启用一个服务）');
      self.state.sending = false;
      self._setSendBtnState(false);
      return;
    }
    var seq = (await self.msgs(conv.id)).length;
    var turnTokensIn = 0, turnTokensOut = 0, turnCache = 0;
    var loops = 0, steps = 0;

    await self.addMsg({ convId: conv.id, seq: seq++, role: 'user', content: userText, createdAt: Date.now() });
    self.appendBubble('user', userText);

    var history = await self.msgs(conv.id);
    var messages = self.buildMessages(conv, history);
    var aborted = false;
    var redoGuard = 0; // 代码输出纠偏次数上限（防死循环）
    var lastCallKey = ''; // 检测重复工具调用死循环
    var repeatCount = 0;

    // 无硬性轮数限制：agent 自主决定是否继续调用工具（仅保留 999 安全兜底防死循环）
    var _lastChunk = 0;
    var openPendingCard = null; // 仍处于「执行中」的流式占位卡（中断/异常时兜底收尾，避免状态永远卡住）
    while (loops < 999 && !aborted) {
      loops++;
      var reply = '';
      var usage = null;
      var ctrl = new AbortController();
      self.state.abortCtrl = ctrl;
      var bubble = self.appendBubble('assistant', '');
      var pendingCard = null; // 实时工具占位卡片（流式→升级为正式卡片）
      try {
        reply = await self.wbStreamChat(
          preset.url,
          { key: preset.key, model: preset.model, temperature: preset.temperature },
          messages,
          ctrl.signal,
          function (delta, fullText) {
            reply = fullText;
            // ---- 流式实时渲染（Markdown + 思考中 + 实时工具调用卡片） ----
            if (!bubble || !bubble._el) return;
            var s = String(fullText || '');
            var toolAt = s.indexOf('[WB_TOOL:');
            var thinkOpen = s.indexOf('<think') >= 0 && s.indexOf('</think>') < 0;
            var now = Date.now();
            if (now - _lastChunk < 60 && !thinkOpen) return; // 节流 60ms
            _lastChunk = now;
            if (thinkOpen) {
              // 思考已开始（<think 出现但未闭合）：显示思考中
              bubble._el.innerHTML = '<div style="display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:12px;">' +
                '<span style="width:10px;height:10px;border:1.5px solid #d97706;border-top-color:transparent;border-radius:50%;display:inline-block;animation:wbSpin 0.8s linear infinite;"></span>思考中…</div>';
              return;
            }
            // 工具标签出现：正文只保留标签前内容；创建可展开的实时占位卡片并持续更新
            var bodyText = toolAt >= 0 ? s.slice(0, toolAt) : s;
            var clean = wbStripToolTag(bodyText);
            var html = self.renderMarkdown(clean);
            if (toolAt >= 0) {
              if (!pendingCard) {
                pendingCard = self.appendToolPendingCard();
                openPendingCard = pendingCard;
              }
              if (pendingCard && pendingCard._update) {
                pendingCard._update(s.slice(toolAt));
              }
            }
            bubble._el.innerHTML = html || '';
          },
          function (u) { usage = u; }
        );
      } catch (e) {
        if (e && e.name === 'AbortError') { aborted = true; }
        else {
          if (openPendingCard && openPendingCard._fail) { openPendingCard._fail('请求失败：' + (e && e.message ? e.message : String(e))); openPendingCard = null; }
          self.appendSysMsg('请求失败: ' + (e && e.message ? e.message : String(e)));
          self.state.sending = false;
          self._setSendBtnState(false);
          return;
        }
      }
      if (aborted) break;

      if (usage && usage.prompt_tokens) turnTokensIn += usage.prompt_tokens;
      if (usage && usage.completion_tokens) turnTokensOut += usage.completion_tokens;
      // 兼容多种 usage 格式：Anthropic prompt_cache_hit_tokens / OpenAI prompt_tokens_details.cached_tokens
      if (usage) {
        var hitTk = usage.prompt_cache_hit_tokens;
        if (!hitTk && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) hitTk = usage.prompt_tokens_details.cached_tokens;
        if (hitTk) turnCache += hitTk;
      }

      await self.addMsg({ convId: conv.id, seq: seq++, role: 'assistant', content: reply, createdAt: Date.now() });

      var toolCalls = self.parseToolCalls ? self.parseToolCalls(reply) : (self.parseToolCall(reply) ? [self.parseToolCall(reply)] : []);
      // ---- 格式掉链子纠偏（对标 DSH 的错误反馈）：检测到 WB_TOOL 标记但解析出 0 个有效标签 → 说明模型输出格式错误，注入错误消息让它重试，绝不默默降级 ----
      if (!toolCalls.length && self.hasToolTag && self.hasToolTag(reply) && redoGuard < 3) {
        redoGuard++;
        if (pendingCard && pendingCard._fail) { pendingCard._fail('工具调用格式错误，已请求重试'); openPendingCard = null; }
        await self.addMsg({ convId: conv.id, seq: seq++, role: 'assistant', content: reply, createdAt: Date.now() });
        messages = messages.concat([
          { role: 'assistant', content: reply },
          { role: 'system', content: '【格式错误反馈】你上一轮输出了 [WB_TOOL:...] 工具调用标记，但格式有误（JSON 解析失败，常见原因：content 字符串内的引号/换行/括号未正确转义，或标签被截断）。请重新输出规范的工具调用标签，格式必须为一行完整的：[WB_TOOL:{"tool":"工具名","arguments":{...}}]；write_file 的 content 请用 JSON 字符串（引号转义为 \"，换行用 \n）。不要输出其他内容，只输出这一个标签。' }
        ]);
        if (bubble && bubble._el) bubble._el.textContent = '（检测到工具调用格式错误，正在请求重试…）';
        continue;
      }
      if (!toolCalls.length) {
        // ---- 代码输出纪律（对标 DSH）：正文出现大段代码块且未调用 write_file → 纠偏重来 ----
        var bloat = false;
        var codeMs = String(reply || '').match(/```[\s\S]*?```/g) || [];
        if (codeMs.length) {
          var codeLines = 0, codeChars = 0;
          codeMs.forEach(function (b) {
            codeLines += b.split('\n').length - 2;
            codeChars += b.length;
          });
          if (codeLines >= 3 || codeChars > 200) bloat = true;
        }
        var usedWrite = /"tool"\s*:\s*"write_file"/.test(String(reply || ''));
        if (bloat && !usedWrite && redoGuard < 3) {
          redoGuard++;
          await self.addMsg({ convId: conv.id, seq: seq++, role: 'assistant', content: reply, createdAt: Date.now() });
          messages = messages.concat([
            { role: 'assistant', content: reply },
            { role: 'system', content: '【纠偏】你刚才在回复正文里直接输出了代码块。按【代码输出纪律】，代码必须通过 write_file 工具写入工作区文件，正文禁止粘贴。请立即调用 write_file（一次一个文件，路径用相对工作区路径），把完整代码落盘；如果路径不确定，先 list_dir / read_file 确认。' }
          ]);
          if (bubble && bubble._el) bubble._el.textContent = '（检测到正文输出代码块，正在纠正为 write_file…）';
          continue;
        }
        // 最终回复：Markdown 渲染（含思考折叠块）
        if (pendingCard && pendingCard._fail) { pendingCard._fail('未生成有效工具调用'); openPendingCard = null; }
        if (bubble && bubble._finalize) bubble._finalize(reply);
        else if (bubble && bubble._el) bubble._el.textContent = wbStripToolTag(reply);
        break;
      }

      // ---- 有工具调用：正文只保留第一个标签前的说明文字（标签之间/之后的代码块不再进正文），逐个执行全部工具卡片 ----
      // 对标 Claude/OpenAI：正文与工具调用分离，一次可含多个 tool_calls
      var textPart = '';
      var firstIdx = toolCalls[0].index;
      if (firstIdx > 0) {
        textPart = wbStripToolTag(reply.slice(0, firstIdx)).trim();
      }
      if (bubble && bubble._finalize) bubble._finalize(textPart);
      else if (bubble && bubble._el) bubble._el.textContent = textPart;

      // 逐个执行工具调用
      for (var ti = 0; ti < toolCalls.length; ti++) {
        steps++;
        var tc = toolCalls[ti];
        // 重复检测：连续 5 次相同工具+相同参数 → 判定死循环，终止
        var callKey = tc.tool + '|' + JSON.stringify(tc.arguments || {});
        if (callKey === lastCallKey) {
          repeatCount++;
          if (repeatCount >= 5) {
            self.appendSysMsg('检测到重复调用相同工具（' + tc.tool + '）多次无进展，已自动停止。');
            aborted = true;
            break;
          }
        } else {
          lastCallKey = callKey;
          repeatCount = 0;
        }
        // 若流式阶段已创建实时占位卡片，原地升级为正式卡片；否则新建
        var card = null;
        if (ti === 0 && pendingCard && pendingCard._upgrade) {
          pendingCard._upgrade(tc.tool, tc.arguments);
          card = pendingCard;
          pendingCard = null;
          openPendingCard = null; // 已升级为正式卡片，交由 _render 收尾
        } else {
          card = self.appendToolCard(tc.tool, tc.arguments);
        }
        var result = await self.executeTool(tc.tool, tc.arguments, conv);
        if (card && card._render) card._render(result);
        var resultText = JSON.stringify(result);
        // 工具结果上限：抓网页/接口的正文较长，6000 字符会把内容砍掉一半；
        // 提高到 14000 并保留「头 75% + 尾 25%」，避免只看到开头。
        var MAX_RESULT_CHARS = 14000;
        if (resultText.length > MAX_RESULT_CHARS) {
          var headLen = Math.floor(MAX_RESULT_CHARS * 0.75);
          resultText = resultText.slice(0, headLen) + '\n...(中间省略 ' + (resultText.length - MAX_RESULT_CHARS) + ' 字符)...\n' + resultText.slice(-(MAX_RESULT_CHARS - headLen));
        }
        await self.addMsg({ convId: conv.id, seq: seq++, role: 'tool', content: resultText, createdAt: Date.now() });
        // 每个工具结果并入 user 消息（保持 system 前缀稳定，利于缓存命中）
        messages = messages.concat([
          { role: 'user', content: '[工具结果] ' + resultText + '（本轮已调用 ' + steps + ' 步工具。任务完成请直接输出结论，不要继续调用工具）' }
        ]);
      }
      if (aborted) break;
      // assistant 回复整体入上下文（含全部工具标签原文），插到工具结果之前、系统消息之后
      var insPos = 0;
      while (insPos < messages.length && messages[insPos].role === 'system') insPos++;
      messages.splice(insPos, 0, { role: 'assistant', content: reply });
      if (messages.length > 40) {
        // 保留最前面的 system 消息（含 Agent/Skills 注入，前缀稳定 → 缓存命中率高）
        var keepSys = [];
        while (messages.length && messages[0].role === 'system') { keepSys.push(messages.shift()); }
        messages = messages.slice(-30);
        messages = keepSys.concat(messages);
      }
    }

    // 兜底收尾：循环因中断/异常退出时，仍处于「执行中」的占位卡必须落到失败态，
    // 否则小条会一直转圈（用户反馈的"明明执行完了还显示执行中"另一类诱因）
    if (openPendingCard && openPendingCard._fail) {
      openPendingCard._fail(aborted ? '已中断' : '未收到执行结果');
      openPendingCard = null;
    }

    var convPatch = {
      totalTokensIn: (conv.totalTokensIn || 0) + turnTokensIn,
      totalTokensOut: (conv.totalTokensOut || 0) + turnTokensOut,
      cacheHits: (conv.cacheHits || 0) + turnCache,
      lastLoops: loops,
      lastSteps: steps
    };
    if (!conv.title || conv.title === '未命名会话') {
      convPatch.title = userText.slice(0, 18) + (userText.length > 18 ? '...' : '');
    }
    await self.updateConv(conv.id, convPatch);
    conv = Object.assign(conv, convPatch);
    self.updateChatHeader(conv);
    self.state.sending = false;
    self.state.abortCtrl = null;
    self._setSendBtnState(false);
    self.scrollToBottom();
  };


  // ==================== Agent / Skill 标准化配置 ====================
  // 对标市面 Agent 工作台：每个对话可绑定一个 Agent（角色/系统提示/模型/温度/启用 Skills），
  // Skill 为标准化能力单元（名称/描述/指令），可启用可自定义。
  WB.wbAgents = {
    list: async function () { try { return (await db.wb_agents.orderBy('updatedAt').reverse().toArray()) || []; } catch (e) { return []; } },
    get: async function (id) { try { return await db.wb_agents.get(Number(id)); } catch (e) { return null; } },
    save: async function (data) {
      if (data.id) { await db.wb_agents.update(Number(data.id), data); return data.id; }
      return await db.wb_agents.add(Object.assign({ enabled: true, skills: [], updatedAt: Date.now() }, data));
    },
    remove: async function (id) { try { await db.wb_agents.delete(Number(id)); } catch (e) {} }
  };
  WB.wbSkills = {
    list: async function () { try { return (await db.wb_skills.orderBy('updatedAt').reverse().toArray()) || []; } catch (e) { return []; } },
    save: async function (data) {
      if (data.id) { await db.wb_skills.update(Number(data.id), data); return data.id; }
      return await db.wb_skills.add(Object.assign({ enabled: true, updatedAt: Date.now() }, data));
    },
    remove: async function (id) { try { await db.wb_skills.delete(Number(id)); } catch (e) {} }
  };

  // ---- 系统提示词注入：Agent 角色 + 启用的 Skills ----
  var _origBuildSystemPrompt = WB.buildSystemPrompt;
  WB.buildSystemPrompt = function (conv) {
    var base = _origBuildSystemPrompt ? _origBuildSystemPrompt.call(this, conv) : '';
    var lines = [];
    var self = this;
    // 注入当前会话绑定的 Agent（同步读取 localStorage 缓存，buildSystemPrompt 不能 await）
    if (conv && conv.agentId) {
      var agent = null;
      try {
        var agentsCache = JSON.parse(localStorage.getItem('wb_agents_cache') || '[]');
        for (var ai = 0; ai < agentsCache.length; ai++) { if (String(agentsCache[ai].id) === String(conv.agentId)) { agent = agentsCache[ai]; break; } }
      } catch (e) { agent = null; }
      if (agent && agent.enabled !== false) {
        lines.push('');
        lines.push('【当前 Agent 角色】' + (agent.name || '未命名'));
        if (agent.description) lines.push('职责描述: ' + agent.description);
        if (agent.systemPrompt) lines.push(agent.systemPrompt);
        if (agent.model) lines.push('（建议模型: ' + agent.model + '）');
        // 启用 Skills
        var skills = (agent.skills || []).filter(Boolean);
        if (skills.length) {
          lines.push('');
          lines.push('【已启用 Skills（请遵循其指令）】');
          // 同步读取已缓存 skill 列表（buildSystemPrompt 为同步函数，不能 await db）
          var allSkills = [];
          try { allSkills = JSON.parse(localStorage.getItem('wb_skills_cache') || '[]'); } catch (e2) { allSkills = []; }
          skills.forEach(function (sid) {
            var sk = null;
            for (var i = 0; i < allSkills.length; i++) { if (String(allSkills[i].id) === String(sid)) { sk = allSkills[i]; break; } }
            if (sk && sk.enabled !== false) {
              lines.push('- Skill「' + sk.name + '」：' + (sk.description || '') + (sk.instructions ? ' 指令：' + sk.instructions : ''));
            }
          });
        }
      }
    }
    return base + lines.join('\n');
  };

  // ---- 缓存 skills / agents 到 localStorage（供 buildSystemPrompt 同步读取） ----
  function wbCacheSkills() {
    db.wb_skills.toArray().then(function (arr) {
      try { localStorage.setItem('wb_skills_cache', JSON.stringify(arr)); } catch (e) {}
    }).catch(function () {});
  }
  function wbCacheAgents() {
    db.wb_agents.toArray().then(function (arr) {
      try { localStorage.setItem('wb_agents_cache', JSON.stringify(arr)); } catch (e) {}
    }).catch(function () {});
  }
  if (db && db.wb_skills) wbCacheSkills();
  if (db && db.wb_agents) wbCacheAgents();
  // 保存/删除 Agent 时刷新缓存
  var _origAgentSave = WB.wbAgents.save;
  WB.wbAgents.save = async function (data) {
    var r = await _origAgentSave.call(this, data);
    wbCacheAgents();
    return r;
  };
  var _origAgentRemove = WB.wbAgents.remove;
  WB.wbAgents.remove = async function (id) {
    var r = await _origAgentRemove.call(this, id);
    wbCacheAgents();
    return r;
  };
  var _origSkillSave = WB.wbSkills.save;
  WB.wbSkills.save = async function (data) {
    var r = await _origSkillSave.call(this, data);
    wbCacheSkills();
    return r;
  };
  var _origSkillRemove = WB.wbSkills.remove;
  WB.wbSkills.remove = async function (id) {
    var r = await _origSkillRemove.call(this, id);
    wbCacheSkills();
    return r;
  };

  // ---- 发送按钮状态机：idle(↑) / sending(进行中，点击中断) ----
  WB._setSendBtnState = function (sending) {
    var btn = document.getElementById('wb-send-btn');
    if (!btn) return;
    var stopBtn = document.getElementById('wb-stop-btn');
    if (sending) {
      btn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
    } else {
      btn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  };
  WB.stopAgent = function () {
    if (this.state.abortCtrl) {
      try { this.state.abortCtrl.abort(); } catch (e) {}
      this.state.abortCtrl = null;
    }
    this.state.sending = false;
    this._setSendBtnState(false);
  };

  // ==================== Agent / Skill 配置弹窗 ====================
  // 输入框右侧 + 按钮打开：选择/新建/编辑 Agent，管理 Skills，管理 MCP
  WB.showAgentMcpDialog = function () {
    var self = this;
    var dlg = this.overlay(
      '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 17, 'color:#6366f1;') + 'Agent 与 Skills</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">为当前对话绑定一个 Agent（角色/系统提示/模型/启用 Skills），Skill 是标准化的能力指令集。</div>' +
      '<div id="wb-agent-list" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;margin-bottom:10px;">加载中...</div>' +
      '<button id="wb-agent-add" style="width:100%;padding:9px;border:1.5px dashed #6366f1;border-radius:10px;background:#eef2ff;font-size:12px;font-weight:700;color:#4338ca;cursor:pointer;margin-bottom:10px;">+ 新建 Agent</button>' +
      '<button id="wb-agent-skills" style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:10px;background:#fff;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;margin-bottom:6px;">⚙ 管理 Skills</button>' +
      '<button id="wb-agent-mcp" style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:10px;background:#fff;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;margin-bottom:6px;">MCP 服务器配置</button>' +
      '<button id="wb-agent-redo" style="width:100%;padding:9px;border:1.5px solid #f59e0b;border-radius:10px;background:#fffbeb;font-size:12px;font-weight:700;color:#b45309;cursor:pointer;">↺ 重回本轮（重新执行上一条消息）</button>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">关闭</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('#wb-agent-add').onclick = function () { self.showAgentEditDialog(null, dlg); };
    dlg.card.querySelector('#wb-agent-skills').onclick = function () { self.showSkillManageDialog(dlg); };
    dlg.card.querySelector('#wb-agent-mcp').onclick = function () { dlg.close(); self.showMcpConfigDialog(); };
    dlg.card.querySelector('#wb-agent-redo').onclick = function () {
      if (self.state.sending) { if (typeof showToast === 'function') showToast('当前正在执行，请稍候'); return; }
      var convId = self.state.activeConvId;
      self.getConv(convId).then(function (conv) {
        if (!conv) return;
        self.msgs(conv.id).then(function (msgs) {
          // 找最后一条 user 消息
          var lastUser = null;
          for (var i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'user') { lastUser = msgs[i].content; break; } }
          if (!lastUser) { if (typeof showToast === 'function') showToast('暂无可重发的消息'); return; }
          dlg.close();
          self.runAgent(conv, lastUser);
        });
      });
    };
    self._renderAgentList(dlg);
  };

  WB._renderAgentList = function (dlg) {
    var self = this;
    var wrap = dlg.card.querySelector('#wb-agent-list');
    if (!wrap) return;
    var currentConvId = self.state.activeConvId;
    self.wbAgents.list().then(function (agents) {
      var allSkills = [];
      try { allSkills = JSON.parse(localStorage.getItem('wb_skills_cache') || '[]'); } catch (e) { allSkills = []; }
      if (!agents.length) { wrap.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:16px 0;">暂无 Agent，点击下方新建</div>'; return; }
      self.getConv(currentConvId).then(function (conv) {
        var boundId = conv && conv.agentId ? String(conv.agentId) : '';
        wrap.innerHTML = agents.map(function (a) {
          var active = String(a.id) === boundId;
          var skNames = (a.skills || []).map(function (sid) {
            for (var i = 0; i < allSkills.length; i++) { if (String(allSkills[i].id) === String(sid)) return allSkills[i].name; }
            return '';
          }).filter(Boolean).join(', ');
          return '<div style="border:1.5px solid ' + (active ? '#6366f1' : 'var(--border)') + ';border-radius:12px;padding:10px 12px;background:' + (active ? '#eef2ff' : '#fff') + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="flex:1;font-size:12px;font-weight:700;color:var(--text-primary);">' + self.esc(a.name) + (active ? ' <span style="font-size:9px;color:#4338ca;background:#c7d2fe;border-radius:6px;padding:1px 6px;">当前</span>' : '') + '</span>' +
              '<button class="wb-agent-bind" data-id="' + a.id + '" style="border:none;background:' + (active ? '#6366f1' : '#f1f5f9') + ';color:' + (active ? '#fff' : '#475569') + ';border-radius:8px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">' + (active ? '已绑定' : '绑定') + '</button>' +
              '<button class="wb-agent-edit" data-id="' + a.id + '" style="border:none;background:none;color:#64748b;cursor:pointer;padding:2px;">' + self.svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', 13) + '</button>' +
              '<button class="wb-agent-del" data-id="' + a.id + '" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:2px;">' + self.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 13) + '</button>' +
            '</div>' +
            (a.description ? '<div style="font-size:10px;color:#94a3b8;margin-top:4px;">' + self.esc(a.description) + '</div>' : '') +
            (skNames ? '<div style="font-size:9px;color:#6366f1;margin-top:4px;">Skills: ' + self.esc(skNames) + '</div>' : '') +
          '</div>';
        }).join('');
        wrap.querySelectorAll('.wb-agent-bind').forEach(function (b) {
          b.onclick = function () {
            var id = Number(b.getAttribute('data-id'));
            self.getConv(currentConvId).then(function (conv) {
              if (!conv) return;
              self.updateConv(conv.id, { agentId: id }).then(function () { self._renderAgentList(dlg); });
            });
          };
        });
        wrap.querySelectorAll('.wb-agent-edit').forEach(function (b) {
          b.onclick = function () { self.wbAgents.get(Number(b.getAttribute('data-id'))).then(function (a) { if (a) self.showAgentEditDialog(a, dlg); }); };
        });
        wrap.querySelectorAll('.wb-agent-del').forEach(function (b) {
          b.onclick = function () {
            var id = Number(b.getAttribute('data-id'));
            self.confirmDialog('删除 Agent', '确定删除该 Agent 配置吗？（不影响已绑定会话）', function () {
              self.wbAgents.remove(id).then(function () { self._renderAgentList(dlg); });
            });
          };
        });
      });
    });
  };

  WB.showAgentEditDialog = function (agent, parentDlg) {
    var self = this;
    var a = agent || { name: '', description: '', systemPrompt: '', model: '', skills: [] };
    var allSkills = [];
    try { allSkills = JSON.parse(localStorage.getItem('wb_skills_cache') || '[]'); } catch (e) { allSkills = []; }
    var dlg = this.overlay(
      '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + (agent ? '编辑 Agent' : '新建 Agent') + '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">名称</div>' +
      '<input id="wb-agent-name" value="' + self.esc(a.name) + '" placeholder="例如: 代码工程师 / 写作助手" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">职责描述</div>' +
      '<input id="wb-agent-desc" value="' + self.esc(a.description || '') + '" placeholder="一句话说明这个 Agent 擅长什么" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">系统提示词（角色设定）</div>' +
      '<textarea id="wb-agent-sys" rows="4" placeholder="你是一名…" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:11px;resize:none;outline:none;margin-bottom:8px;">' + self.esc(a.systemPrompt || '') + '</textarea>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">建议模型（可留空跟随全局）</div>' +
      '<input id="wb-agent-model" value="' + self.esc(a.model || '') + '" placeholder="例如 deepseek-chat（留空使用当前模型）" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:10px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">启用 Skills（可多选）</div>' +
      '<div id="wb-agent-skills-pick" style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;margin-bottom:10px;">' +
        (allSkills.length ? allSkills.map(function (sk, idx) {
          var checked = (a.skills || []).indexOf(sk.id) >= 0;
          return '<label style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#f8fafc;border-radius:8px;font-size:11px;cursor:pointer;">' +
            '<input type="checkbox" class="wb-agent-sk-chk" data-id="' + sk.id + '" ' + (checked ? 'checked' : '') + ' style="accent-color:#6366f1;">' +
            '<span style="flex:1;color:var(--text-primary);font-weight:600;">' + self.esc(sk.name) + '</span>' +
            '<span style="color:#94a3b8;font-size:9px;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.esc(sk.description || '') + '</span>' +
          '</label>';
        }).join('') : '<div style="font-size:10px;color:#94a3b8;">暂无 Skill，可在"管理 Skills"中创建</div>') +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
        '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('.wb-dlg-ok').onclick = async function () {
      var name = dlg.card.querySelector('#wb-agent-name').value.trim();
      if (!name) { if (typeof showToast === 'function') showToast('请填写 Agent 名称'); return; }
      var skills = [];
      dlg.card.querySelectorAll('.wb-agent-sk-chk').forEach(function (chk) { if (chk.checked) skills.push(Number(chk.getAttribute('data-id'))); });
      var data = Object.assign({}, a, {
        name: name,
        description: dlg.card.querySelector('#wb-agent-desc').value.trim(),
        systemPrompt: dlg.card.querySelector('#wb-agent-sys').value,
        model: dlg.card.querySelector('#wb-agent-model').value.trim(),
        skills: skills,
        updatedAt: Date.now()
      });
      await self.wbAgents.save(data);
      dlg.close();
      if (parentDlg) self._renderAgentList(parentDlg);
      if (typeof showToast === 'function') showToast('Agent 已保存');
    };
  };

  // ---- Skills 管理 ----
  WB.showSkillManageDialog = function (parentDlg) {
    var self = this;
    var dlg = this.overlay(
      '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', 16, 'color:#6366f1;') + 'Skills 管理</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">Skill = 标准化能力指令集，可被任意 Agent 启用。内置 Skill 由系统提供，自定义 Skill 可自由增删。</div>' +
      '<div id="wb-skill-list" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;margin-bottom:10px;">加载中...</div>' +
      '<button id="wb-skill-add" style="width:100%;padding:9px;border:1.5px dashed #6366f1;border-radius:10px;background:#eef2ff;font-size:12px;font-weight:700;color:#4338ca;cursor:pointer;">+ 新建 Skill</button>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">关闭</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); if (parentDlg) self._renderAgentList(parentDlg); };
    dlg.card.querySelector('#wb-skill-add').onclick = function () { self.showSkillEditDialog(null, dlg); };
    self._renderSkillList(dlg);
  };

  WB._renderSkillList = function (dlg) {
    var self = this;
    var wrap = dlg.card.querySelector('#wb-skill-list');
    if (!wrap) return;
    self.wbSkills.list().then(function (skills) {
      if (!skills.length) { wrap.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:16px 0;">暂无 Skill，点击下方新建</div>'; return; }
      wrap.innerHTML = skills.map(function (s) {
        return '<div style="border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="flex:1;font-size:12px;font-weight:700;color:var(--text-primary);">' + self.esc(s.name) + (s.builtin ? ' <span style="font-size:9px;color:#94a3b8;background:#f1f5f9;border-radius:6px;padding:1px 6px;">内置</span>' : '') + '</span>' +
            '<button class="wb-skill-edit" data-id="' + s.id + '" style="border:none;background:none;color:#64748b;cursor:pointer;padding:2px;">' + self.svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', 13) + '</button>' +
            '<button class="wb-skill-del" data-id="' + s.id + '" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:2px;">' + self.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 13) + '</button>' +
          '</div>' +
          (s.description ? '<div style="font-size:10px;color:#94a3b8;margin-top:4px;">' + self.esc(s.description) + '</div>' : '') +
        '</div>';
      }).join('');
      wrap.querySelectorAll('.wb-skill-edit').forEach(function (b) {
        b.onclick = function () { self.wbSkills.list().then(function (arr) { var s = arr.find(function (x) { return x.id === Number(b.getAttribute('data-id')); }); if (s) self.showSkillEditDialog(s, dlg); }); };
      });
      wrap.querySelectorAll('.wb-skill-del').forEach(function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute('data-id'));
          self.confirmDialog('删除 Skill', '确定删除该 Skill 吗？', function () {
            self.wbSkills.remove(id).then(function () { wbCacheSkills(); self._renderSkillList(dlg); });
          });
        };
      });
    });
  };

  WB.showSkillEditDialog = function (skill, parentDlg) {
    var self = this;
    var s = skill || { name: '', description: '', instructions: '' };
    var dlg = this.overlay(
      '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + (skill ? '编辑 Skill' : '新建 Skill') + '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">名称</div>' +
      '<input id="wb-skill-name" value="' + self.esc(s.name) + '" placeholder="例如: 代码审查 / 数据库查询" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">描述</div>' +
      '<input id="wb-skill-desc" value="' + self.esc(s.description || '') + '" placeholder="一句话描述该 Skill 的用途" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">指令（注入系统提示词）</div>' +
      '<textarea id="wb-skill-inst" rows="4" placeholder="告诉 Agent 启用此 Skill 后应遵循的行为规范…" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:11px;resize:none;outline:none;margin-bottom:10px;">' + self.esc(s.instructions || '') + '</textarea>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
        '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('.wb-dlg-ok').onclick = async function () {
      var name = dlg.card.querySelector('#wb-skill-name').value.trim();
      if (!name) { if (typeof showToast === 'function') showToast('请填写 Skill 名称'); return; }
      var data = Object.assign({}, s, {
        name: name,
        description: dlg.card.querySelector('#wb-skill-desc').value.trim(),
        instructions: dlg.card.querySelector('#wb-skill-inst').value,
        updatedAt: Date.now()
      });
      await self.wbSkills.save(data);
      wbCacheSkills();
      dlg.close();
      if (parentDlg) self._renderSkillList(parentDlg);
      if (typeof showToast === 'function') showToast('Skill 已保存');
    };
  };

  // ==================== MCP 传输协议扩展：http / streamable_http / sse ====================
  var _origMcpRpc = WB.wbMCP && WB.wbMCP.rpc;
  if (WB.wbMCP) {
    // sse: JSON-RPC over SSE——先 GET 建立流并等待 endpoint 事件，再向 endpoint POST
    function mcpRpcSse(server, method, params) {
      return new Promise(function (resolve, reject) {
        var base = String(server.url || '').replace(/\/+$/, '');
        var headers = Object.assign({ 'Accept': 'text/event-stream' }, server.headers || {});
        var es = null;
        var endpoint = null;
        var finished = false;
        function done(err, val) {
          if (finished) return;
          finished = true;
          if (es) { try { es.close(); } catch (e) {} }
          if (err) reject(err); else resolve(val);
        }
        try {
          if (typeof EventSource !== 'undefined') {
            es = new EventSource(base, { headers: headers });
            es.onmessage = function (ev) {
              try {
                var data = JSON.parse(ev.data);
                if (data && data.type === 'endpoint' && data.endpoint) {
                  endpoint = data.endpoint;
                  es.close();
                  var full = endpoint.indexOf('http') === 0 ? endpoint : base + endpoint;
                  fetch(full, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, server.headers || {}),
                    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params || {} })
                  }).then(function (res) {
                    if (!res.ok) return done(new Error('HTTP ' + res.status));
                    var ct = String(res.headers.get('content-type') || '');
                    if (ct.indexOf('text/event-stream') >= 0) {
                      var reader = res.body.getReader();
                      var dec = new TextDecoder('utf-8');
                      var buf = '';
                      function pump() {
                        return reader.read().then(function (rr) {
                          if (rr.done) return;
                          buf += dec.decode(rr.value, { stream: true });
                          var lines = buf.split('\n');
                          buf = lines.pop() || '';
                          lines.forEach(function (ln) {
                            if (ln.indexOf('data:') === 0) {
                              var d = ln.slice(5).trim();
                              if (!d || d === '[DONE]') return;
                              try {
                                var j = JSON.parse(d);
                                if (j.id) {
                                  if (j.error) done(new Error(j.error.message || 'JSON-RPC 错误'));
                                  else done(null, j.result);
                                }
                              } catch (e) {}
                            }
                          });
                          if (!finished) return pump();
                        }).catch(function (e) { done(e); });
                      }
                      pump();
                    } else {
                      res.json().then(function (j) {
                        if (j && j.error) done(new Error(j.error.message || 'JSON-RPC 错误 ' + j.error.code));
                        else done(null, j && j.result);
                      }).catch(function (e) { done(e); });
                    }
                  }).catch(function (e) { done(e); });
                }
              } catch (e) {}
            };
            es.onerror = function () { done(new Error('SSE 连接失败: ' + base)); };
          } else {
            done(new Error('当前环境不支持 EventSource'));
          }
        } catch (e) {
          done(e);
        }
      });
    }
    WB.wbMCP.rpc = async function (server, method, params) {
      var type = String(server.type || 'streamable_http');
      if (type === 'sse') {
        return mcpRpcSse(server, method, params);
      }
      var url = String(server.url || '').replace(/\/+$/, '');
      var isStream = type !== 'http';
      var headers = Object.assign({ 'Content-Type': 'application/json' }, server.headers || {});
      headers['Accept'] = isStream ? 'application/json, text/event-stream' : 'application/json';
      var res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params || {} }) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + String(await res.text()).slice(0, 200));
      var data = await res.json();
      if (data.error) throw new Error(data.error.message || 'JSON-RPC 错误 ' + data.error.code);
      return data.result;
    };
  }
})();

// ============ 输入区增强：+ 按钮 / @ 引用工作区文件 / MCP 协议类型选择 ============
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  // ---- 包装 renderChat：在输入区模型选择器右侧注入 + 按钮，并绑定 @ 引用 ----
  var origRenderChat = WB.renderChat;
  if (typeof origRenderChat === 'function') {
    WB.renderChat = function (conv, msgs) {
      var ret = origRenderChat.apply(this, arguments);
      this._enhanceInputArea(conv);
      return ret;
    };
  }

  WB._enhanceInputArea = function (conv) {
    var self = this;
    var pill = document.getElementById('wb-model-pill');
    var sendBtn = document.getElementById('wb-send-btn');
    if (!pill || !sendBtn) return;
    // 若已注入过则不重复注入
    if (document.getElementById('wb-agent-plus')) return;
    var plus = document.createElement('button');
    plus.id = 'wb-agent-plus';
    plus.title = '配置 Agent 与 MCP';
    plus.style.cssText = 'border:1px solid #e2e8f0;background:#f8fafc;border-radius:999px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#6366f1;cursor:pointer;flex-shrink:0;';
    plus.innerHTML = self.svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 13);
    pill.parentNode.insertBefore(plus, pill.nextSibling);
    plus.onclick = function () { self.showAgentMcpDialog(); };

    // @ 引用：输入框聚焦/输入时若以 @ 结尾，弹出工作区文件选择浮层
    var input = document.getElementById('wb-input');
    if (input && !input._wbAtBound) {
      input._wbAtBound = true;
      input.addEventListener('input', function () { self._maybeShowFilePicker(input); });
      input.addEventListener('blur', function () { setTimeout(function () { self._hideFilePicker(); }, 200); });
    }
  };

  WB._maybeShowFilePicker = function (input) {
    var self = this;
    var val = input.value;
    var m = val.match(/@([^\s@]*)$/);
    if (!m) { this._hideFilePicker(); return; }
    var q = m[1];
    this._showFilePicker(q, input);
  };

  WB._filePicker = null;
  WB._showFilePicker = function (query, input) {
    var self = this;
    if (!this.fs || !this.fs._guard || !this.fs._guard()) {
      this._hideFilePicker();
      return;
    }
    var el = this._filePicker;
    if (!el) {
      el = document.createElement('div');
      el.id = 'wb-file-picker';
      el.style.cssText = 'position:absolute;left:8px;right:8px;bottom:52px;background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 30px rgba(15,23,42,0.15);z-index:999;max-height:220px;overflow-y:auto;display:none;';
      document.body.appendChild(el);
      this._filePicker = el;
    }
    var self2 = this;
    // 递归列出工作区文件（两层）
    function walk(dir, depth, out) {
      if (depth > 2 || out.length > 60) return;
      var r = self2.fs.listDir(dir);
      var entries = (r && r.ok && r.entries) ? r.entries : [];
      entries.forEach(function (en) {
        if (en.type === 'dir') {
          out.push({ name: dir + en.name + '/', type: 'dir' });
          walk(dir + en.name + '/', depth + 1, out);
        } else {
          out.push({ name: dir + en.name, type: 'file' });
        }
      });
    }
    var items = [];
    walk('', 0, items);
    var filtered = query ? items.filter(function (it) { return it.name.toLowerCase().indexOf(query.toLowerCase()) >= 0; }) : items;
    if (!filtered.length) {
      el.innerHTML = '<div style="padding:14px;font-size:11px;color:#94a3b8;text-align:center;">未找到匹配文件</div>';
      el.style.display = 'block';
      return;
    }
    el.innerHTML = filtered.slice(0, 30).map(function (it) {
      return '<div class="wb-fp-item" data-path="' + self2.esc(it.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11px;cursor:pointer;border-bottom:1px solid #f1f5f9;">' +
        (it.type === 'dir'
          ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#0e7490" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>') +
        '<span style="color:' + (it.type === 'dir' ? '#0e7490' : 'var(--text-primary)') + ';">' + self2.esc(it.name) + '</span></div>';
    }).join('');
    el.style.display = 'block';
    el.querySelectorAll('.wb-fp-item').forEach(function (item) {
      item.onclick = function () {
        var path = item.getAttribute('data-path');
        var input2 = document.getElementById('wb-input');
        if (input2) {
          var val = input2.value;
          input2.value = val.replace(/@[^\s@]*$/, '@' + path.replace(/\/$/, '') + ' ');
          input2.focus();
          input2.dispatchEvent(new Event('input'));
          if (typeof self2._resizeInput === 'function') self2._resizeInput();
        }
        self2._hideFilePicker();
      };
    });
  };

  WB._hideFilePicker = function () {
    if (this._filePicker) this._filePicker.style.display = 'none';
  };

  // ---- onSendChat 包装：解析 @ 引用文件——只传路径指导 agent 自行读/写，不把内容塞进上下文 ----
  var origOnSendChat = WB.onSendChat;
  WB.onSendChat = function () {
    var self = this;
    var input = document.getElementById('wb-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text || this.state.sending) return;
    var convId = this.state.activeConvId;
    // 提取 @引用路径，仅告知 agent 路径，由 agent 决定读取还是修改（节省上下文、避免大文件塞入）
    var refRe = /@([^\s@]+)/g;
    var mm;
    var refs = [];
    var used = {};
    while ((mm = refRe.exec(text)) !== null) {
      var refPath = mm[1].replace(/\/$/, '');
      if (used[refPath]) continue;
      used[refPath] = true;
      refs.push(refPath);
    }
    input.value = '';
    this._resizeInput();
    var finalText = text;
    var convIdNum = convId;
    this.getConv(convIdNum).then(function (conv) {
      if (!conv) return;
      // 把 @路径 转成"引用指引"：告诉 agent 这些文件路径，让它按需自行 read_file / write_file
      if (refs.length) {
        finalText = finalText + '\n\n【工作区文件引用】以下路径是用户通过 @ 引用的工作区文件（相对工作区根）：\n' +
          refs.map(function (rp) { return '- ' + rp; }).join('\n') +
          '\n请根据需要自行调用 read_file 读取内容、或 write_file 修改它们，不要假设内容。';
      }
      self.runAgent(conv, finalText);
    });
  };

  // ---- showMcpEditDialog 覆盖：增加传输协议选择（http / streamable_http / sse） ----
  var origMcpEdit = WB.showMcpEditDialog;
  WB.showMcpEditDialog = function (server, parentDlg) {
    var self = this;
    var s = server || { name: '', group: '默认', type: 'streamable_http', url: '', headers: null, tools: [] };
    var dlg = this.overlay(
      '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + (server ? '编辑 MCP 服务器' : '添加 MCP 服务器') + '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">名称</div>' +
      '<input id="wb-mcp-name" value="' + self.esc(s.name) + '" placeholder="例如: 我的工具箱" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">URL</div>' +
      '<input id="wb-mcp-url" value="' + self.esc(s.url || '') + '" placeholder="https://..." style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">传输协议</div>' +
      '<select id="wb-mcp-type" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;background:#fff;">' +
        '<option value="streamable_http"' + (s.type === 'streamable_http' ? ' selected' : '') + '>streamable_http（POST JSON-RPC，兼容 OpenAI/Anthropic 网关）</option>' +
        '<option value="http"' + (s.type === 'http' ? ' selected' : '') + '>http（标准 POST JSON-RPC）</option>' +
        '<option value="sse"' + (s.type === 'sse' ? ' selected' : '') + '>sse（JSON-RPC over Server-Sent Events）</option>' +
      '</select>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">自定义 Headers（JSON，可选）</div>' +
      '<textarea id="wb-mcp-headers" rows="2" placeholder="Headers JSON（可选），如 Bearer 认证" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:11px;resize:none;outline:none;margin-bottom:10px;">' + self.esc(s.headers ? JSON.stringify(s.headers) : '') + '</textarea>' +
      '<div id="wb-mcp-tools" style="display:none;margin-bottom:10px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span style="font-size:11px;font-weight:700;color:var(--text-primary);flex:1;">工具列表</span><button id="wb-mcp-fetch" style="border:1px solid #6366f1;background:#eef2ff;color:#4338ca;border-radius:8px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">拉取 tools/list</button></div>' +
        '<div id="wb-mcp-tools-list" style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
        '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存</button>' +
      '</div>'
    );
    var toolsBox = dlg.card.querySelector('#wb-mcp-tools');
    var toolsList = dlg.card.querySelector('#wb-mcp-tools-list');
    var currentTools = (s.tools || []).slice();
    function renderTools() {
      if (!currentTools.length) { toolsList.innerHTML = '<div style="font-size:10px;color:#94a3b8;">暂无工具（点击拉取或保存后由 Agent 探测）</div>'; return; }
      toolsList.innerHTML = currentTools.map(function (t, idx) {
        return '<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:#f8fafc;border-radius:6px;font-size:10px;cursor:pointer;">' +
          '<input type="checkbox" class="wb-mcp-tool-chk" data-idx="' + idx + '" ' + (t.enabled !== false ? 'checked' : '') + ' style="accent-color:#6366f1;">' +
          '<span style="flex:1;color:var(--text-primary);font-weight:600;">' + self.esc(t.name) + '</span>' +
          '<span style="color:#94a3b8;font-size:9px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.esc(t.description || '') + '</span>' +
        '</label>';
      }).join('');
      toolsList.querySelectorAll('.wb-mcp-tool-chk').forEach(function (chk) {
        chk.onchange = function () { currentTools[Number(chk.getAttribute('data-idx'))].enabled = chk.checked; };
      });
    }
    renderTools();
    if (currentTools.length) toolsBox.style.display = 'block';
    dlg.card.querySelector('#wb-mcp-fetch').onclick = async function () {
      var name = dlg.card.querySelector('#wb-mcp-name').value.trim();
      var url = dlg.card.querySelector('#wb-mcp-url').value.trim();
      var type = dlg.card.querySelector('#wb-mcp-type').value;
      var headersRaw = dlg.card.querySelector('#wb-mcp-headers').value.trim();
      if (!name || !url) { if (typeof showToast === 'function') showToast('请先填写名称与 URL'); return; }
      var headers = {};
      if (headersRaw) { try { headers = JSON.parse(headersRaw); } catch (e) { if (typeof showToast === 'function') showToast('Headers 不是合法 JSON'); return; } }
      var temp = { name: name, url: url, headers: headers, type: type };
      toolsList.innerHTML = '<div style="font-size:10px;color:#94a3b8;">正在拉取...</div>';
      try {
        var fetched = await self.wbMCP.fetchTools(temp);
        currentTools = fetched.map(function (t) { return { name: t.name, description: t.description || '', inputSchema: t.inputSchema || {}, enabled: true }; });
        toolsBox.style.display = 'block';
        renderTools();
        if (typeof showToast === 'function') showToast('拉取到 ' + fetched.length + ' 个工具');
      } catch (e) {
        toolsList.innerHTML = '<div style="font-size:10px;color:#dc2626;">拉取失败: ' + self.esc(e.message) + '</div>';
      }
    };
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('.wb-dlg-ok').onclick = async function () {
      var name = dlg.card.querySelector('#wb-mcp-name').value.trim();
      var url = dlg.card.querySelector('#wb-mcp-url').value.trim();
      var type = dlg.card.querySelector('#wb-mcp-type').value;
      var headersRaw = dlg.card.querySelector('#wb-mcp-headers').value.trim();
      if (!name || !url) { if (typeof showToast === 'function') showToast('请填写名称与 URL'); return; }
      var headers = {};
      if (headersRaw) { try { headers = JSON.parse(headersRaw); } catch (e) { if (typeof showToast === 'function') showToast('Headers 不是合法 JSON'); return; } }
      var data = Object.assign({}, s, { name: name, url: url, type: type, headers: headers, tools: currentTools, updatedAt: Date.now() });
      await self.wbMCP.save(data);
      var promptTools = await self.wbMCP.promptTools();
      try { localStorage.setItem('wb_mcp_prompt_tools', JSON.stringify(promptTools)); } catch (e) {}
      dlg.close();
      if (parentDlg) self._renderMcpList(parentDlg);
      if (typeof showToast === 'function') showToast('MCP 服务器已保存');
    };
  };
})();

// ============ 工作区存储权限引导（Download 工作区，Android 11+ 需「所有文件访问」） ============
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  /** 检查工作区是否位于公共 Download；未授权时弹窗引导去系统设置开启 */
  WB.ensurePublicWorkspace = function (silent) {
    try {
      if (window.AndroidMCP && typeof window.AndroidMCP.wbIsPublicWorkspace === 'function') {
        var isPub = !!window.AndroidMCP.wbIsPublicWorkspace();
        if (isPub) return true;
        if (silent) return false;
        var dlg = WB.overlay(
          '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">需要「所有文件访问」权限</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:14px;">工作区已迁移到公共目录 <b>Download/workbench</b>（方便你用文件管理器直接查看/修改）。' +
          'Android 11+ 需要在系统设置中开启「所有文件访问」权限才能读写该目录。<br><br>' +
          '点击下方按钮前往系统设置开启，返回后重新进入即可生效。</div>' +
          '<button class="wb-dlg-perm" style="width:100%;padding:10px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;margin-bottom:8px;">前往设置开启权限</button>' +
          '<button class="wb-dlg-skip" style="width:100%;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">暂不（继续用 App 私有目录）</button>'
        );
        dlg.card.querySelector('.wb-dlg-perm').onclick = function () {
          try { if (window.AndroidMCP && window.AndroidMCP.wbRequestStoragePermission) window.AndroidMCP.wbRequestStoragePermission(); } catch (e) {}
        };
        dlg.card.querySelector('.wb-dlg-skip').onclick = function () { dlg.close(); };
        return false;
      }
      return true;
    } catch (e) { return true; }
  };

  // 包装工作区切换按钮：点击时若未授权公共工作区则引导
  var _origWsPick = WB.onWsPick;
  if (typeof _origWsPick === 'function') {
    WB.onWsPick = function () {
      if (!this.ensurePublicWorkspace()) return;
      return _origWsPick.apply(this, arguments);
    };
  }

  // 输入区工作区标签点击也可触发引导（若显示为"未授权"）
  var _origEnhance = WB._enhanceInputArea;
  if (typeof _origEnhance === 'function') {
    WB._enhanceInputArea = function (conv) {
      var ret = _origEnhance.apply(this, arguments);
      var self = this;
      // 若工作区未授权，把标签改为可点击提示
      try {
        if (window.AndroidMCP && typeof window.AndroidMCP.wbIsPublicWorkspace === 'function' && !window.AndroidMCP.wbIsPublicWorkspace()) {
          var wsTxt = document.querySelector('#wb-msgs') ? null : null;
          var btn = document.querySelector('.wb-ws-pick');
          if (btn) {
            btn.onclick = function () { self.ensurePublicWorkspace(); };
          }
        }
      } catch (e) {}
      return ret;
    };
  }

  // 工作区信息展示：标记公共/私有
  var _origWorkspaceInfo = WB.tools && WB.tools.workspace_info;
  if (WB.tools && WB.tools.workspace_info) {
    var _origWsInfo = WB.tools.workspace_info;
    WB.tools.workspace_info = function (args, conv) {
      var r = _origWsInfo ? _origWsInfo(args, conv) : { ok: true };
      try {
        if (window.AndroidMCP && typeof window.AndroidMCP.wbIsPublicWorkspace === 'function') {
          r.publicWorkspace = !!window.AndroidMCP.wbIsPublicWorkspace();
        }
      } catch (e) {}
      return r;
    };
  }

  // 进入对话后自动检查工作区权限（每会话首次进入时弹一次引导，避免打扰）
  var _origShowChat = WB.showChat;
  if (typeof _origShowChat === 'function') {
    WB.showChat = function (convId) {
      var self = this;
      var ret = _origShowChat.apply(this, arguments);
      if (ret && ret.then) {
        ret.then(function (conv) {
          try {
            if (window.AndroidMCP && typeof window.AndroidMCP.wbIsPublicWorkspace === 'function' && !window.AndroidMCP.wbIsPublicWorkspace()) {
              var key = 'wb_perm_prompt_' + (conv ? conv.id : convId);
              var prompted = false;
              try { prompted = localStorage.getItem(key) === '1'; } catch (e) {}
              if (!prompted) {
                try { localStorage.setItem(key, '1'); } catch (e) {}
                setTimeout(function () { self.ensurePublicWorkspace(); }, 600);
              }
            }
          } catch (e) {}
        }).catch(function () {});
      }
      return ret;
    };
  }
})();

// ============ 历史回显统一：tool 消息卡片化 + assistant 剥离工具标签 ============
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  WB.renderStoredMsg = function (container, m) {
    var self = this;
    if (m.role === 'user') {
      this.appendBubble('user', m.content);
    } else if (m.role === 'assistant') {
      // 历史 assistant 消息：剥离 WB_TOOL 标签后渲染（避免"爆代码"）
      var bubble = this.appendBubble('assistant', '');
      var clean = WB._stripToolTag ? WB._stripToolTag(m.content) : m.content;
      if (bubble && bubble._finalize) bubble._finalize(clean);
      else if (bubble && bubble._el) bubble._el.textContent = clean;
    } else if (m.role === 'tool') {
      // 历史工具结果：渲染为可折叠工具卡片（不再显示"爆代码"原始 JSON）
      try {
        var parsed = JSON.parse(m.content || '');
        var ok = !!(parsed && parsed.ok);
        var card = this.appendToolCard('tool_result', {});
        if (card && card._render) card._render(ok ? parsed : { ok: false, error: (parsed && parsed.error) || '未知错误' });
      } catch (e) {
        var div = document.createElement('div');
        div.style.cssText = 'align-self:flex-start;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:10px;padding:8px 10px;font-size:10px;color:#64748b;max-width:88%;word-break:break-all;';
        div.textContent = '[工具结果] ' + String(m.content || '').slice(0, 200);
        container.appendChild(div);
      }
    } else {
      var sys = document.createElement('div');
      sys.style.cssText = 'align-self:center;font-size:10px;color:#94a3b8;background:#f8fafc;border-radius:8px;padding:4px 10px;max-width:80%;';
      sys.textContent = m.content;
      container.appendChild(sys);
    }
  };
})();

// ============ 工作区标准配置文件：AGENTS.md + .workbench/skills/*.md（对标 Claude Code / 市面 Agent 工作台） ============
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  var AGENTS_MD = '# AGENTS.md\n\n这是本工作区的项目级 Agent 说明文件（对标 Claude Code / Cursor 的 AGENTS.md 标准）。\n\n## 项目概述\n在这里描述本项目/工作区的目标与结构。\n\n## 代码规范\n- 保持简洁、可读\n- 中文注释\n\n## 工作约定\n- 修改文件前先读取确认\n- 删除/覆盖前先询问用户\n';

  var SKILL_TEMPLATE = '---\nname: 我的技能\ndescription: 一句话描述这个技能的作用\n---\n\n# 技能指令\n\n启用此 Skill 后，请遵循以下行为规范：\n\n- 规则 1\n- 规则 2\n';

  // 内置 Skill：代码审查（对标 DSH 等 Agent 平台的自动审查工作流）
  var SKILL_CODE_REVIEW = [
    '---',
    'name: 代码审查',
    'description: 自动对工作区代码进行结构化审查（探索→逐文件读取→问题清单→改进建议）',
    '---',
    '',
    '# 代码审查工作流',
    '',
    '当用户要求「审查代码」「检查代码质量」「帮我看看这个项目」等代码类任务时，必须执行以下工具循环，禁止凭空回答：',
    '',
    '## 第 1 步：探索项目结构',
    '- 调用 list_dir 查看工作区根目录，了解项目有哪些文件/目录',
    '- 根据文件类型（.js/.kt/.py/.html/.css 等）确定要审查的范围',
    '',
    '## 第 2 步：逐个读取代码文件',
    '- 调用 read_file 读取每个目标文件的完整内容',
    '- 一次读一个文件，读完再读下一个（工具结果会作为上下文返回）',
    '- 大文件注意分段（read_file 会自动截断超 512KB 的文件）',
    '',
    '## 第 3 步：分析问题',
    '对每个文件检查：',
    '- 语法/明显的 bug（未定义变量、错误函数签名、逻辑矛盾）',
    '- 代码规范（命名、缩进、重复代码、魔法数字）',
    '- 安全隐患（硬编码密钥、注入风险、危险操作无校验）',
    '- 性能问题（无谓循环、同步阻塞、内存泄漏）',
    '',
    '## 第 4 步：输出结构化审查报告',
    '按以下格式汇报：',
    '### 审查范围',
    '- 文件清单与行数',
    '### 发现的问题',
    '- **严重问题**（会导致崩溃/错误）：文件 + 行号 + 说明',
    '- **一般问题**（规范/可维护性）：文件 + 说明',
    '- **建议**（优化点）：文件 + 说明',
    '### 总体评价',
    '- 一句话总结代码质量',
    '',
    '## 注意',
    '- 若工作区为空或没有代码文件，明确告诉用户并建议先创建项目',
    '- 用户可以要求修复问题：此时调用 write_file 修改，修改前先说明改了什么',
    ''
  ].join('\n');
  WB._SKILL_CODE_REVIEW = SKILL_CODE_REVIEW;

  /** 扫描工作区中的标准配置文件 */
  WB.scanWorkspaceConfig = function (conv) {
    var result = { agents: null, skills: [] };
    if (!this.fs || !this.fs._guard || !this.fs._guard()) return result;
    var root = conv && conv.workspace ? conv.workspace : '.';
    // AGENTS.md
    var ag = this.fs.readFile((root === '.' ? '' : root + '/') + 'AGENTS.md');
    if (ag && ag.ok) result.agents = { path: 'AGENTS.md', content: ag.content || '' };
    // .workbench/skills/*.md
    var skillDir = (root === '.' ? '' : root + '/') + '.workbench/skills';
    var dir = this.fs.listDir(skillDir);
    if (dir && dir.ok && dir.entries) {
      dir.entries.forEach(function (en) {
        if (en.type !== 'file' || !/\.md$/i.test(en.name)) return;
        var fr = WB.fs.readFile(skillDir + '/' + en.name);
        if (fr && fr.ok) {
          var meta = parseSkillMd(fr.content || '');
          result.skills.push({ file: en.name, path: skillDir + '/' + en.name, name: meta.name || en.name.replace(/\.md$/i, ''), description: meta.description || '', instructions: meta.instructions || '' });
        }
      });
    }
    return result;
  };

  /** 解析 SKILL.md 的 frontmatter（--- name/description --- 正文指令） */
  function parseSkillMd(content) {
    var out = { name: '', description: '', instructions: '' };
    var m = String(content || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (m) {
      var fm = m[1];
      var nm = fm.match(/^name:\s*(.+)$/m);
      var dm = fm.match(/^description:\s*(.+)$/m);
      if (nm) out.name = nm[1].trim();
      if (dm) out.description = dm[1].trim();
      out.instructions = (m[2] || '').trim();
    } else {
      out.instructions = String(content || '').trim();
    }
    return out;
  }
  WB._parseSkillMd = parseSkillMd;

  /** 确保工作区有标准配置文件（无则创建模板） */
  WB.ensureWorkspaceConfig = function (conv, onDone) {
    var self = this;
    if (!this.fs || !this.fs._guard || !this.fs._guard()) { if (onDone) onDone(false); return; }
    var root = conv && conv.workspace ? conv.workspace : '.';
    var base = root === '.' ? '' : root + '/';
    var wb = this.fs.readFile(base + 'AGENTS.md');
    if (!(wb && wb.ok)) {
      this.fs.writeFile(base + 'AGENTS.md', AGENTS_MD);
    }
    var skillDir = this.fs.listDir(base + '.workbench/skills');
    if (!(skillDir && skillDir.ok)) {
      this.fs.mkdir(base + '.workbench');
      this.fs.mkdir(base + '.workbench/skills');
      this.fs.writeFile(base + '.workbench/skills/示例技能.md', SKILL_TEMPLATE);
    }
    // 预置内置「代码审查」Skill（对标 DSH 自动审查；仅首次创建，用户可自由编辑）
    var crFile = base + '.workbench/skills/代码审查.md';
    var cr = this.fs.readFile(crFile);
    if (!(cr && cr.ok)) {
      this.fs.writeFile(crFile, SKILL_CODE_REVIEW);
    }
    if (onDone) onDone(true);
  };

  // ---- buildSystemPrompt 注入工作区配置文件 ----
  var _origBuild2 = WB.buildSystemPrompt;
  WB.buildSystemPrompt = function (conv) {
    var base = _origBuild2 ? _origBuild2.call(this, conv) : '';
    var lines = [];
    try {
      var cfg = this.scanWorkspaceConfig ? this.scanWorkspaceConfig(conv) : null;
      if (cfg) {
        if (cfg.agents && cfg.agents.content) {
          lines.push('');
          lines.push('【项目级 AGENTS.md（请遵循）】');
          lines.push(String(cfg.agents.content).slice(0, 3000));
        }
        if (cfg.skills && cfg.skills.length) {
          lines.push('');
          lines.push('【工作区 Skills（.workbench/skills）】');
          cfg.skills.forEach(function (sk) {
            lines.push('- Skill「' + (sk.name || sk.file) + '」：' + (sk.description || '') + (sk.instructions ? ' 指令：' + sk.instructions.slice(0, 500) : ''));
          });
        }
      }
    } catch (e) {}
    // ---- 代码任务强制工具循环（对标 DSH：代码类任务禁止凭空回答，必须实际调用工具） ----
    lines.push('');
    lines.push('【代码任务工作流（极其重要）】');
    lines.push('当用户提出代码类任务（写代码/审查代码/修改代码/排查 bug/了解项目结构）时，你必须像真正的 Agent 一样实际调用工具完成，禁止仅凭想象回答：');
    lines.push('1. 先调用 list_dir 查看工作区结构，确定相关文件；');
    lines.push('2. 再调用 read_file 读取目标文件内容（一次一个文件，按需逐个读取）；');
    lines.push('3. 基于真实文件内容分析、修改（write_file）或创建文件；');
    lines.push('4. 审查类任务按「代码审查」工作流输出：审查范围 → 问题清单（严重/一般/建议）→ 总体评价；');
    lines.push('5. 修改文件前先向用户说明要改什么，涉及删除/覆盖前必须征得同意。');
    lines.push('如果工作区为空或没有相关代码，明确告诉用户，而不是编造内容。');
    // ---- 代码输出纪律（对标 DSH：代码只允许通过 write_file 落盘，正文禁止粘贴大段代码） ----
    lines.push('');
    lines.push('【代码输出纪律（极其重要，违反会丢代码）】');
    lines.push('- 写代码/改代码的【唯一】途径是调用 write_file 工具，把完整代码写入工作区文件。');
    lines.push('- 你的回复正文【禁止】出现超过 3 行的代码块。需要给用户展示代码时，先 write_file 落盘，然后在正文里用 1~3 行说明文件路径与作用，不要整段粘贴。');
    lines.push('- 一次只调用一个工具：创建多个文件请多次调用 write_file（每次单独一行 [WB_TOOL:...]）。');
    lines.push('- 如果系统提示你「请用 write_file 写入」而你仍直接输出代码，任务会被视为失败并继续纠正，直到代码真正落盘。');
    return base + lines.join('\n');
  };

  // ---- 加号弹窗增加「工作区配置文件」区块 ----
  // 通过包装 overlay 记录最新卡片，供 showAgentMcpDialog 注入使用
  var _origOverlay = WB.overlay;
  if (typeof _origOverlay === 'function') {
    WB.overlay = function (contentHtml, width) {
      var d = _origOverlay.call(this, contentHtml, width);
      WB._lastOverlay = d;
      return d;
    };
  }
  var _origAgentMcp = WB.showAgentMcpDialog;
  if (typeof _origAgentMcp === 'function') {
    WB.showAgentMcpDialog = function () {
      var self = this;
      _origAgentMcp.apply(this, arguments);
      // 在弹窗打开后注入工作区配置区块
      setTimeout(function () {
        var card = WB._lastOverlay ? WB._lastOverlay.card : null;
        if (!card) return;
        var mcpBtn = card.querySelector('#wb-agent-mcp');
        if (!mcpBtn) return;
        var block = document.createElement('div');
        block.id = 'wb-ws-config-block';
        block.style.cssText = 'margin-top:10px;border:1.5px solid #e2e8f0;border-radius:12px;padding:10px 12px;background:#f8fafc;';
        block.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">' + self.svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>', 13, 'color:#0e7490;') + '工作区标准配置</div>' +
          '<div id="wb-ws-config-list" style="font-size:10px;color:#64748b;line-height:1.7;">扫描中...</div>';
        mcpBtn.parentNode.insertBefore(block, mcpBtn.nextSibling);
        self._renderWsConfigList(block, self.state.activeConvId);
      }, 120);
    };
  }

  WB._renderWsConfigList = function (block, convId) {
    var self = this;
    var list = block.querySelector('#wb-ws-config-list');
    if (!list) return;
    self.getConv(convId).then(function (conv) {
      if (!conv) return;
      if (!self.fs || !self.fs._guard || !self.fs._guard()) {
        list.innerHTML = '<div style="color:#94a3b8;">链接版无本地文件系统，无法使用工作区配置。</div>';
        return;
      }
      // 确保存在
      self.ensureWorkspaceConfig(conv, function () {
        var cfg = self.scanWorkspaceConfig(conv);
        var html = '';
        html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;"><span style="flex:1;">📄 AGENTS.md</span>' +
          '<button class="wb-ws-edit-file" data-path="AGENTS.md" style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:2px 8px;font-size:9px;color:#475569;cursor:pointer;">' + (cfg.agents ? '查看/编辑' : '创建') + '</button></div>';
        if (cfg.skills && cfg.skills.length) {
          cfg.skills.forEach(function (sk) {
            html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚙ ' + self.esc(sk.name || sk.file) + '</span>' +
              '<button class="wb-ws-edit-file" data-path="' + self.esc(sk.path) + '" style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:2px 8px;font-size:9px;color:#475569;cursor:pointer;">编辑</button></div>';
          });
        }
        if (!cfg.skills.length) html += '<div style="color:#94a3b8;">尚无 Skills，可在 .workbench/skills/ 添加 *.md（frontmatter: name/description）</div>';
        list.innerHTML = html;
        list.querySelectorAll('.wb-ws-edit-file').forEach(function (btn) {
          btn.onclick = function () {
            var path = btn.getAttribute('data-path');
            self.showWorkspaceFileEditor(conv, path);
          };
        });
      });
    });
  };

  // ---- 工作区配置文件编辑器 ----
  WB.showWorkspaceFileEditor = function (conv, path) {
    var self = this;
    var rel = (conv.workspace && conv.workspace !== '.' ? conv.workspace + '/' : '') + path;
    var existing = this.fs.readFile(rel);
    var content = (existing && existing.ok) ? (existing.content || '') : (path === 'AGENTS.md' ? AGENTS_MD : SKILL_TEMPLATE);
    var dlg = this.overlay(
      '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">' + this.svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>', 16, 'color:#0e7490;') + '编辑 ' + this.esc(path) + '</div>' +
      '<textarea id="wb-ws-edit-content" rows="12" style="width:100%;box-sizing:border-box;border:1.5px solid var(--border);border-radius:10px;padding:10px;font-size:12px;font-family:ui-monospace,monospace;resize:vertical;outline:none;color:var(--text-primary);line-height:1.6;">' + this.esc(content) + '</textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
        '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('.wb-dlg-ok').onclick = function () {
      var val = dlg.card.querySelector('#wb-ws-edit-content').value;
      var res = self.fs.writeFile(rel, val);
      if (res && res.ok) {
        dlg.close();
        if (typeof showToast === 'function') showToast('已保存 ' + path);
      } else {
        if (typeof showToast === 'function') showToast('保存失败: ' + ((res && res.error) || '未知'));
      }
    };
  };

  // 初始化：进入对话时确保工作区配置存在（静默创建模板）
  var _origShowChat3 = WB.showChat;
  if (typeof _origShowChat3 === 'function') {
    WB.showChat = function (convId) {
      var self = this;
      var ret = _origShowChat3.apply(this, arguments);
      if (ret && ret.then) {
        ret.then(function (conv) {
          if (conv && self.fs && self.fs._guard && self.fs._guard()) {
            self.ensureWorkspaceConfig(conv);
          }
        }).catch(function () {});
      }
      return ret;
    };
  }
})();







// ============ 内置 Skill 种子：代码审查（db.wb_skills 预置，Agent 可勾选启用） ============
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  var SEEDED_KEY = 'wb_skill_seeded_v1';
  function seed() {
    try {
      if (localStorage.getItem(SEEDED_KEY) === '1') return;
      if (!db || !db.wb_skills) return;
      db.wb_skills.toArray().then(function (arr) {
        var has = arr.some(function (s) { return s.builtin === true && s.name === '代码审查'; });
        if (!has) {
          var crText = WB._SKILL_CODE_REVIEW || '';
          db.wb_skills.add({
            name: '代码审查',
            description: '自动对工作区代码进行结构化审查（探索→逐文件读取→问题清单→改进建议）',
            instructions: crText.slice(0, 2000),
            builtin: true,
            enabled: true,
            updatedAt: Date.now()
          }).then(function () {
            try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) {}
            db.wb_skills.toArray().then(function (a2) { try { localStorage.setItem('wb_skills_cache', JSON.stringify(a2)); } catch (e) {} }).catch(function () {});
          }).catch(function () {});
        } else {
          try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) {}
        }
      }).catch(function () {});
    } catch (e) {}
  }
  setTimeout(seed, 800);
})();

