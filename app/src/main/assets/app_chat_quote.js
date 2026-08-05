/**
 * app_chat_quote.js - 线上对话消息引用与滑动交互引擎
 */

(function() {
  // 1. 主动注入微信与 QQ 经典引用样式的 CSS 规则
  const style = document.createElement("style");
  style.textContent = `
    /* 微信/QQ 经典引用预览条 */
    .quote-preview-bar {
      background-color: #ededed;
      border-top: 1px solid var(--border);
      padding: 6px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748b;
      animation: fadeIn 0.15s ease-out;
    }
    .quote-preview-content {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 80%;
      font-weight: 500;
    }

    /* 对白气泡内部渲染的引用卡片 */
    .quote-render-block {
      background: rgba(0, 0, 0, 0.04);
      border-left: 2px solid #ccc;
      padding-left: 8px;
      margin-bottom: 6px;
      font-size: 11px;
      color: #555555;
      line-height: 1.4;
      max-width: 100%;
      word-break: break-all;
    }
    .msg-bubble.self .quote-render-block {
      color: #3f6212;
      border-left-color: #4d7c0f;
      background: rgba(0, 0, 0, 0.05);
    }
  `;
  document.head.appendChild(style);

  // 沙箱化安全过滤函数，避免对外部同名函数产生依赖
  function localEscapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }

  // 2. 声明局部状态与引用模块
  let activeQuoteMsgId = null;

  class QuoteSystem {
    constructor() {
      // 监听对话框 DOM 加载后，自动挂载滑动交互
      document.addEventListener("DOMContentLoaded", () => {
        this.initGestureListener();
      });
    }

    // 获取当前处于激活引用的消息ID
    getActiveQuote() {
      return activeQuoteMsgId;
    }

    // 设置并开启引用预览条
    async setQuote(msgId) {
      activeQuoteMsgId = Number(msgId);
      try {
        const msg = await db.messages.get(activeQuoteMsgId);
        if (!msg) return;

        let senderName = "未知好友";
        const session = await db.sessions.get(msg.sessionId);
        if (msg.senderType === 'user') {
          const user = session ? await db.archives.get(session.userId) : null;
          senderName = session?.customUserName || user?.name || "我";
        } else if (msg.senderType === 'char') {
          if (session && session.isGroup === 1) {
            if (Number(msg.senderId) === 99999) {
              const groupObj = await db.groups.get(session.groupId);
              const botObj = (groupObj && groupObj.bots && groupObj.bots.length > 0) ? groupObj.bots[0] : null;
              senderName = botObj ? botObj.name : "群助手";
            } else {
              const charObj = await db.archives.get(Number(msg.senderId));
              senderName = charObj ? (charObj.remark || charObj.name) : "群成员";
            }
          } else {
            const char = session ? await db.archives.get(session.charId) : null;
            senderName = session?.customCharName || char?.name || "对方";
          }
        } else if (msg.senderType === 'system') {
          senderName = "系统通知";
        }

        let displayText = msg.content;
        if (typeof displayText === 'string') {
          displayText = displayText.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '');
        }
        if (msg.contentType === 'image') {
          try {
            const data = JSON.parse(msg.content);
            displayText = `[图片] ${data.text || ''}`;
          } catch(e) { displayText = '[图片]'; }
        } else if (msg.contentType === 'voice') {
          try {
            const data = JSON.parse(msg.content);
            displayText = `[语音] ${data.text || ''}`;
          } catch(e) { displayText = '[语音]'; }
        } else if (msg.contentType === 'transfer') {
          displayText = '[微信转账]';
        } else if (msg.contentType === 'red_envelope') {
          displayText = '[微信红包]';
        }

        if (displayText.length > 20) {
          displayText = displayText.substring(0, 20) + '...';
        }

        // 动态将预览栏插入输入框上方
        this.renderPreviewBar(senderName, displayText);
      } catch(err) {
        console.error("加载引用源消息失败:", err);
      }
    }

    // 渲染预览卡片 DOM
    renderPreviewBar(senderName, text) {
      this.clearQuoteDOM();

      const inputContainer = document.querySelector(".dialog-input-container");
      if (!inputContainer) return;

      const bar = document.createElement("div");
      bar.id = "quote-preview-bar";
      bar.className = "quote-preview-bar";
      bar.innerHTML = `
        <span class="quote-preview-content">引用 ${localEscapeHtml(senderName)}: "${localEscapeHtml(text)}"</span>
        <button class="btn-icon" style="width:20px; height:20px;" onclick="window.quoteSystem.clearQuote()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

      // 穿插在输入区域内部的最上方
      inputContainer.insertBefore(bar, inputContainer.firstChild);
    }

    // 清除引用
    clearQuote() {
      activeQuoteMsgId = null;
      this.clearQuoteDOM();
    }

    clearQuoteDOM() {
      const bar = document.getElementById("quote-preview-bar");
      if (bar) bar.remove();
    }

    // 挂载 QQ 式向左滑动手势器
    initGestureListener() {
      const container = document.getElementById("dialog-messages-container");
      if (!container) return;

      let startX = 0;
      let startY = 0;
      let currentBubble = null;
      let isSwiping = false;

      container.addEventListener('touchstart', (e) => {
        // 解耦表情选择器与消息滑动引用：若触点始于选择面板或已贴表情，彻底阻止底层气泡左滑
        if (e.target.closest('.bubble-emoji-picker') || e.target.closest('.bubble-attached-emoji')) return;

        const bubble = e.target.closest('.msg-bubble');
        if (!bubble) return;
        currentBubble = bubble;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
      }, { passive: true });

      container.addEventListener('touchmove', (e) => {
        if (!currentBubble) return;
        const diffX = e.touches[0].clientX - startX;
        const diffY = e.touches[0].clientY - startY;

        // 仅当水平向左滑动位移显著，且无明显的上下滚动行为时触发
        if (diffX < 0 && Math.abs(diffX) > 15 && Math.abs(diffX) > Math.abs(diffY)) {
          isSwiping = true;
          // 阻断父级容器的滚动滚动
          if (e.cancelable) e.preventDefault();
          currentBubble.style.transition = 'none';
          currentBubble.style.transform = `translateX(${Math.max(-70, diffX)}px)`;
        }
      }, { passive: false });

      container.addEventListener('touchend', () => {
        if (!currentBubble) return;
        
        // 结束滑动，触发流畅的回弹过渡动效
        currentBubble.style.transition = 'transform 0.15s ease-out';
        currentBubble.style.transform = '';

        const lastDiffX = event.changedTouches[0].clientX - startX;
        if (isSwiping && lastDiffX < -45) {
          const msgId = currentBubble.getAttribute('data-msg-id');
          if (msgId) {
            this.setQuote(Number(msgId));
          }
        }
        currentBubble = null;
        isSwiping = false;
      }, { passive: true });
    }

    // 格式化与解析对白里的引用指令，兼容标准与非标准中英文全半角括号
    async parseQuote(content) {
      if (typeof content !== 'string') return null;
      
      const match = content.match(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i);
      if (!match) return null;

      const quoteMsgId = Number(match[2]);
      let cleanText = content.replace(match[0], '').trim();

      try {
        const quotedMsg = await db.messages.get(quoteMsgId);
        if (!quotedMsg) return { quoteHtml: '', cleanText };

        // 核心自愈：自动清洗可能意外漏过或幻觉产生的复读被引用消息原文的异常行为 [1.1]
        const origText = quotedMsg.content;
        const origBareText = typeof origText === 'string' ? origText.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '').trim() : "";
        if (origBareText) {
          // 1. 拦截清洗 bare text 物理重复：如 "[QUOTE:1] 你真好 我也觉得" -> "我也觉得"
          if (cleanText.toLowerCase().startsWith(origBareText.toLowerCase())) {
            cleanText = cleanText.substring(origBareText.length).trim();
          }
          
          // 2. 拦截并清洗带中英文引号的重复：如 '[QUOTE:1] "原话" 你的新回复'
          const quotesRegex = /^["'“‘『「\(（【\[]*(.*?)[”’』」\)）】\]]*\s*/;
          const quoteMatch = cleanText.match(quotesRegex);
          if (quoteMatch) {
            const innerText = quoteMatch[1].trim();
            if (innerText && (innerText.toLowerCase() === origBareText.toLowerCase() || origBareText.toLowerCase().includes(innerText.toLowerCase()))) {
              cleanText = cleanText.replace(quotesRegex, '').trim();
            }
          }
        }

        let senderName = "未知好友";
        const session = await db.sessions.get(quotedMsg.sessionId);
        if (quotedMsg.senderType === 'user') {
          const user = session ? await db.archives.get(session.userId) : null;
          senderName = session?.customUserName || user?.name || "我";
        } else if (quotedMsg.senderType === 'char') {
          if (session && session.isGroup === 1) {
            if (Number(quotedMsg.senderId) === 99999) {
              const groupObj = await db.groups.get(session.groupId);
              const botObj = (groupObj && groupObj.bots && groupObj.bots.length > 0) ? groupObj.bots[0] : null;
              senderName = botObj ? botObj.name : "群助手";
            } else {
              const charObj = await db.archives.get(Number(quotedMsg.senderId));
              senderName = charObj ? (charObj.remark || charObj.name) : "群成员";
            }
          } else {
            const char = session ? await db.archives.get(session.charId) : null;
            senderName = session?.customCharName || char?.name || "对方";
          }
        } else if (quotedMsg.senderType === 'system') {
          senderName = "系统通知";
        }

        let displayText = quotedMsg.content;
        if (typeof displayText === 'string') {
          displayText = displayText.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '');
        }
        if (quotedMsg.contentType === 'image') {
          try {
            const data = JSON.parse(quotedMsg.content);
            displayText = `[图片] ${data.text || ''}`;
          } catch(e) { displayText = '[图片]'; }
        } else if (quotedMsg.contentType === 'voice') {
          try {
            const data = JSON.parse(quotedMsg.content);
            displayText = `[语音] ${data.text || ''}`;
          } catch(e) { displayText = '[语音]'; }
        } else if (quotedMsg.contentType === 'transfer') {
          displayText = '[微信转账]';
        } else if (quotedMsg.contentType === 'red_envelope') {
          displayText = '[微信红包]';
        }

        if (displayText.length > 50) {
          displayText = displayText.substring(0, 50) + '...';
        }

        const quoteHtml = `<div class="quote-render-block"><b>${localEscapeHtml(senderName)}</b>: ${localEscapeHtml(displayText)}</div>`;
        return { quoteHtml, cleanText };
      } catch(err) {
        console.warn("引用解析失败:", err);
        return { quoteHtml: '', cleanText };
      }
    }
  }

  // 暴露至全局命名空间
  window.quoteSystem = new QuoteSystem();
})();