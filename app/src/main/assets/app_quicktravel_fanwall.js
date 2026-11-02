/**
 * app_quicktravel_fanwall.js - 第四面墙·故人来信
 * ============================================================
 * 设计理念：
 *   当一个快穿局剧本完结时，打破第四面墙——
 *   世界观中与玩家纠葛最深的角色，跨越世界线发来消息。
 *
 * 流程：
 *   1. 点完结 → 立即出完结动画（同时后台并行调用 AI 判定角色）
 *   2. 动画结束 → 变屏闪现「有故人来信，是否查看？」
 *   3a. 否分支（信件）：页头"字迹正在浮现…" → 打字逐字显示信件
 *   3b. 是分支（对话）：页头"对方正在输入中…" → 微信气泡逐条发送
 *   4. 是分支发送完毕 → 「归档」/「深入」选项
 *
 * 依赖：app_quicktravel.js（通过 window.qtInternals）、db.js（qt_fanwall_letters）
 * ============================================================
 */
(function () {
  'use strict';

  function getInternals() {
    const i = window.qtInternals;
    if (!i || !i.qtCallAI) throw new Error('快穿局内核未就绪');
    return i;
  }

  // 生成首字头像（角色名第一个字）
  function generateInitialAvatar(name) {
    const ch = String(name || '?').charAt(0) || '?';
    const colors = ['#3b82f6', '#0f766e', '#8b5cf6', '#e11d48', '#b45309', '#0891b2'];
    const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='${color}'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='#fff' font-family='sans-serif' font-weight='700'>${ch}</text></svg>`
    );
  }

  // ============================================================
  // 1. 主触发入口：任务完结 → 全屏动画（并行AI判定）→ 故人来信
  // ============================================================
  window.qtFanwallTrigger = async function (gameId) {
    try {
      const game = await db.qt_games.get(gameId);
      if (!game) return;
      const worldview = await db.qt_worldviews.get(game.worldviewId);
      if (!worldview) return;
      const identity = await db.qt_identity.get(game.identityId);
      const messages = await db.qt_messages.where('gameId').equals(gameId).toArray();
      const summaries = await db.qt_summaries.where('gameId').equals(gameId).toArray();

      const userTurns = messages.filter(m => m.role === 'user');
      if (userTurns.length < 3) return;

      // 关键改进：开场动画与 AI 判定并行执行，消除卡顿感
      const curtainPromise = playOpeningCurtain(game, worldview);
      const charPromise = pickDeepestChar(worldview, messages, summaries, identity);

      await curtainPromise;
      const chosenChar = await charPromise;
      if (!chosenChar) return;

      // 变屏闪现：有故人来信，是否查看？
      const choice = await askViewLetter(chosenChar);
      if (choice === 'no') {
        await runLetterBranch(game, worldview, identity, chosenChar, messages, summaries);
      } else {
        await runDialogBranch(game, worldview, identity, chosenChar, messages, summaries);
      }
    } catch (e) {
      console.error('第四面墙流程异常:', e);
    }
  };

  // ============================================================
  // 2. 判定与玩家纠葛最深的角色
  // ============================================================
  async function pickDeepestChar(worldview, messages, summaries, identity) {
    const internals = getInternals();
    const clean = internals.qtCleanTagsForContext;

    let candidates = [];
    if (Array.isArray(worldview.characters)) {
      candidates = worldview.characters.filter(c => c && c.name);
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const early = messages.slice(0, 10).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 200)).join('\n');
    const late = messages.slice(-10).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 200)).join('\n');
    const summaryText = summaries.map(s => '第' + s.round + '轮：' + (s.plotShift || '') + '；' + (s.relationshipChanges || '')).join('\n');
    const charList = candidates.map((c, i) => `${i + 1}. ${c.name}（${c.identity || ''}）`).join('\n');

    const prompt = `你是一位文学分析家。请根据以下文游记录，判定哪一位角色与玩家（${identity ? identity.name : '玩家'}）的纠葛最深、情感牵绊最强。

【候选角色】
${charList}

【最初几轮对话】
${early}

【最后几轮对话】
${late}

【剧情总结】
${summaryText}

请只输出纠葛最深的那位角色的姓名（与候选列表完全一致），不要任何其他文字。`;

    try {
      const name = await internals.qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 60 });
      const trimmed = name.trim();
      const found = candidates.find(c => c.name === trimmed);
      return found || candidates[0];
    } catch (e) {
      return candidates[0];
    }
  }

  // ============================================================
  // 3. 全屏开场动画：任务完结 → 缓缓浮现
  // ============================================================
  function playOpeningCurtain(game, worldview) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'qt-fanwall-curtain';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f1e 60%, #000 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: #e2e8f0; font-family: -apple-system, "PingFang SC", serif;
        opacity: 0; transition: opacity 1.8s ease;
      `;
      overlay.innerHTML = `
        <div style="opacity:0; transition: opacity 2s ease 1.2s;" id="qt-fanwall-stage1">
          <div style="font-size: 22px; letter-spacing: 8px; font-weight: 300; color: #94a3b8; text-align: center;">任务完结</div>
          <div style="width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #64748b, transparent); margin: 24px auto;"></div>
          <div style="font-size: 13px; color: #475569; text-align: center; letter-spacing: 2px;">${escapeHtml(game.title || worldview.title || '')}</div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
      setTimeout(() => {
        const s1 = document.getElementById('qt-fanwall-stage1');
        if (s1) s1.style.opacity = '1';
      }, 100);
      // 4 秒后淡出进入选择
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); resolve(); }, 800);
      }, 4000);
    });
  }

  // ============================================================
  // 4. 变屏闪现：有故人来信，是否查看？
  // ============================================================
  function askViewLetter(char) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'qt-fanwall-ask';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f1e 70%, #000 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: #e2e8f0; font-family: -apple-system, "PingFang SC", serif;
        opacity: 0; transition: opacity 0.6s ease;
      `;
      overlay.innerHTML = `
        <div style="font-size: 17px; letter-spacing: 4px; color: #cbd5e1; text-align: center; font-weight: 300; opacity:0; transition: opacity 1.5s ease 0.3s;" id="qt-fanwall-ask-main">
          有故人来信
        </div>
        <div style="font-size: 12px; color: #64748b; text-align: center; margin-top: 10px; letter-spacing: 1px; opacity:0; transition: opacity 1.5s ease 1s;" id="qt-fanwall-ask-sub">
          是否查看？
        </div>
        <div style="font-size: 13px; color: #94a3b8; letter-spacing: 3px; margin-top: 40px; opacity:0; transition: opacity 1s ease 2s;" id="qt-fanwall-ask-from">来自</div>
        <div style="font-size: 24px; color: #f1f5f9; font-weight: 300; letter-spacing: 4px; margin-top: 6px; opacity:0; transition: opacity 1s ease 2.3s;" id="qt-fanwall-ask-name">${escapeHtml(char.name)}</div>
        <div style="font-size: 11px; color: #475569; margin-top: 8px; max-width: 260px; text-align: center; line-height: 1.7; opacity:0; transition: opacity 1s ease 2.6s;" id="qt-fanwall-ask-id">${escapeHtml(char.identity || '')}</div>
        <div style="display: flex; gap: 16px; margin-top: 50px; opacity:0; transition: opacity 0.8s ease 3s;" id="qt-fanwall-ask-btns">
          <button id="qt-fanwall-yes" style="padding: 12px 36px; border: 1px solid rgba(148,163,184,0.4); background: rgba(30,41,59,0.6); color: #e2e8f0; border-radius: 4px; font-size: 14px; letter-spacing: 2px; cursor: pointer; backdrop-filter: blur(10px); transition: all 0.3s;">查看</button>
          <button id="qt-fanwall-no" style="padding: 12px 36px; border: 1px solid rgba(148,163,184,0.2); background: transparent; color: #64748b; border-radius: 4px; font-size: 14px; letter-spacing: 2px; cursor: pointer; transition: all 0.3s;">收起信件</button>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
      // 逐层浮现
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-main'); if (e) e.style.opacity = '1'; }, 300);
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-sub'); if (e) e.style.opacity = '1'; }, 1000);
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-from'); if (e) e.style.opacity = '1'; }, 2000);
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-name'); if (e) e.style.opacity = '1'; }, 2300);
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-id'); if (e) e.style.opacity = '1'; }, 2600);
      setTimeout(() => { const e = document.getElementById('qt-fanwall-ask-btns'); if (e) e.style.opacity = '1'; }, 3000);

      document.getElementById('qt-fanwall-yes').onclick = () => { overlay.remove(); resolve('yes'); };
      document.getElementById('qt-fanwall-no').onclick = () => { overlay.remove(); resolve('no'); };
    });
  }

  // ============================================================
  // 5. 否分支：信件（页头"字迹正在浮现…"）
  // ============================================================
  async function runLetterBranch(game, worldview, identity, char, messages, summaries) {
    const internals = getInternals();
    const clean = internals.qtCleanTagsForContext;

    const earlyMsgs = messages.slice(0, 8).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 150)).join('\n');
    const lateMsgs = messages.slice(-8).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 150)).join('\n');
    const summaryText = summaries.map(s => (s.plotShift || '') + '；' + (s.relationshipChanges || '')).join('\n');

    const prompt = `你是「${char.name}」。这是你在玩家离开此世界线后，写给玩家（${identity ? identity.name : '你'}）的一封信。

【你的身份与性格】
${char.identity || ''}
${(worldview.worldBackground || '').slice(0, 300)}

【你与玩家共同经历的开端】
${earlyMsgs}

【你与玩家最终的结局】
${lateMsgs}

【剧情总结】
${summaryText}

写信要求：
1. 必须完全用你（${char.name}）的口吻、性格、说话习惯来写。如果你是暴躁的人，绝不会温柔地说话；如果你冷漠，就不会热情。
2. 写玩家离开这个世界后，你的生活是怎样的，这个世界后续如何发展。
3. 写你对玩家的感觉——可以是思念、怨恨、释然、不甘，取决于你的人设和你们的关系。
4. 情真意切，但绝不能 OOC（脱离人设）。
5. 字数 400-700 字。
6. 直接输出信件正文，不要写"亲爱的"等称呼开头（用你自己的方式称呼），不要署名后的注释。`;

    // 立即显示信件界面（带"字迹正在浮现…"页头）
    const overlay = showLetterLoading(char);
    try {
      const letter = await internals.qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.9 });
      // 切换页头：字迹正在浮现… → 来自 xxx 的信
      switchLetterHeader(overlay, char);
      // 逐字打字显示
      await typewriterLetter(overlay, letter, char);
      await db.qt_fanwall_letters.add({
        gameId: game.id,
        charName: char.name,
        charIdentity: char.identity || '',
        branch: 'letter',
        content: letter,
        deepened: 0,
        createdAt: Date.now()
      });
      await waitForLetterClose(overlay);
    } catch (e) {
      console.error('信件生成失败:', e);
      overlay.querySelector('.qt-fanwall-letter-body').innerHTML = '<div style="color:#94a3b8; text-align:center; padding:40px;">信件未能送达。</div>';
      await waitForLetterClose(overlay);
    }
  }

  function showLetterLoading(char) {
    const overlay = document.createElement('div');
    overlay.id = 'qt-fanwall-letter';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      padding: 0 24px 90px; overflow-y: auto;
      color: #e2e8f0; font-family: -apple-system, "PingFang SC", serif;
    `;
    overlay.innerHTML = `
      <div id="qt-fanwall-letter-header" style="position:sticky; top:0; width:100%; max-width:360px; padding:20px 0 12px; text-align:center; background:linear-gradient(180deg, #1a1a2e 80%, transparent); z-index:2;">
        <div class="qt-fanwall-letter-header-text" style="font-size: 12px; color: #64748b; letter-spacing: 3px;">
          <span class="qt-fanwall-pulse" style="display:inline-block;">字迹正在浮现</span>
          <span class="qt-fanwall-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
      <div style="width: 30px; height: 1px; background: #475569; margin-bottom: 30px;"></div>
      <div class="qt-fanwall-letter-body" style="max-width: 320px; line-height: 2.1; font-size: 14.5px; color: #cbd5e1; white-space: pre-wrap; letter-spacing: 0.5px; min-height: 200px; width:100%;"></div>
      <div style="height: 20px;"></div>
      <!-- 固定底部的关闭按钮，始终可见 -->
      <div style="position:fixed; bottom:0; left:0; right:0; padding:16px 24px; background:linear-gradient(0deg, #1a1a2e 70%, transparent); display:flex; justify-content:center; z-index:3;">
        <button id="qt-fanwall-letter-close" style="padding: 12px 48px; border: 1px solid rgba(148,163,184,0.4); background: rgba(30,41,59,0.8); color: #cbd5e1; border-radius: 6px; font-size: 14px; letter-spacing: 3px; cursor: pointer; display:none; backdrop-filter: blur(10px); transition: all 0.3s;">收起信件</button>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  // 页头从"字迹正在浮现…"切换为"来自 xxx 的信"
  function switchLetterHeader(overlay, char) {
    const headerText = overlay.querySelector('.qt-fanwall-letter-header-text');
    if (headerText) {
      headerText.innerHTML = `<span style="color:#94a3b8;">来自 ${escapeHtml(char.name)} 的信</span>`;
    }
  }

  function typewriterLetter(overlay, text, char) {
    return new Promise((resolve) => {
      const body = overlay.querySelector('.qt-fanwall-letter-body');
      const closeBtn = overlay.querySelector('#qt-fanwall-letter-close');
      let i = 0;
      const speed = 35;
      const timer = setInterval(() => {
        if (i < text.length) {
          body.textContent = text.slice(0, i + 1);
          i++;
          // 只在每5个字符滚动一次，减少抖动
          if (i % 5 === 0) overlay.scrollTop = overlay.scrollHeight;
        } else {
          clearInterval(timer);
          closeBtn.style.display = 'block';
          closeBtn.style.opacity = '0';
          requestAnimationFrame(() => { closeBtn.style.opacity = '1'; });
          resolve();
        }
      }, speed);
    });
  }

  function waitForLetterClose(overlay) {
    return new Promise((resolve) => {
      const btn = overlay.querySelector('#qt-fanwall-letter-close');
      if (btn) {
        btn.onclick = () => {
          btn.innerText = '正在收起...';
          btn.disabled = true;
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.8s ease';
          setTimeout(() => { overlay.remove(); resolve(); }, 800);
        };
      } else {
        setTimeout(() => { overlay.remove(); resolve(); }, 5000);
      }
    });
  }

  // ============================================================
  // 6. 是分支：微信打字样式对话（页头"对方正在输入中…"）
  // ============================================================
  async function runDialogBranch(game, worldview, identity, char, messages, summaries) {
    const internals = getInternals();
    const clean = internals.qtCleanTagsForContext;

    const earlyMsgs = messages.slice(0, 8).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 150)).join('\n');
    const lateMsgs = messages.slice(-8).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 150)).join('\n');
    const summaryText = summaries.map(s => (s.plotShift || '') + '；' + (s.relationshipChanges || '')).join('\n');

    const prompt = `你是「${char.name}」。玩家（${identity ? identity.name : '你'}）已经离开了你所在的世界线，时间过去了 2周到3年不等（请你根据剧情合理判定具体过去了多久）。

【你的人设】
${char.identity || ''}
${(worldview.worldBackground || '').slice(0, 300)}

【你与玩家的开端】
${earlyMsgs}

【你与玩家的结局】
${lateMsgs}

【剧情总结】
${summaryText}

现在你要给玩家发几条消息（就像微信聊天一样，分句发送）。要求：
1. 完全用你（${char.name}）的口吻、性格、习惯说话，绝不 OOC。
2. 内容是你想对玩家说的话——可以提及现在的生活、对玩家的想念或别的感觉、这个世界发生的变化。
3. 情真意切，但符合人设。
4. 将内容拆成 4-7 条消息，每条 15-60 字。
5. 严格按以下 JSON 数组格式输出，每条是一个字符串，不要任何其他文字：
["消息1","消息2","消息3",...]`;

    // 立即显示微信界面（带"对方正在输入中…"页头）
    const overlay = showWeChatDialog(char);
    try {
      const result = await internals.qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.9 });
      const msgList = internals.qtParseJSON(result, null);
      // 切换页头为角色名（消息开始发送）
      switchWeChatHeader(overlay, char, true);
      if (!Array.isArray(msgList) || msgList.length === 0) {
        const fallback = result.split('\n').filter(s => s.trim()).slice(0, 6);
        await playWeChatMessages(overlay, fallback, char);
      } else {
        await playWeChatMessages(overlay, msgList, char);
      }
      const action = await showArchiveOrDeepen(overlay);
      await db.qt_fanwall_letters.add({
        gameId: game.id,
        charName: char.name,
        charIdentity: char.identity || '',
        branch: 'dialog',
        content: JSON.stringify(Array.isArray(msgList) ? msgList : []),
        deepened: action === 'deepen' ? 1 : 0,
        createdAt: Date.now()
      });
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.8s';
      setTimeout(() => overlay.remove(), 800);
      if (action === 'deepen') {
        await deepenCharacter(game, worldview, identity, char, messages, summaries, Array.isArray(msgList) ? msgList : []);
      }
    } catch (e) {
      console.error('对话生成失败:', e);
      overlay.querySelector('.qt-fanwall-wx-body').innerHTML += '<div style="color:#94a3b8; text-align:center; padding:20px;">消息未能送达。</div>';
      setTimeout(() => overlay.remove(), 3000);
    }
  }

  function showWeChatDialog(char) {
    const avatar = generateInitialAvatar(char.name);
    const overlay = document.createElement('div');
    overlay.id = 'qt-fanwall-wechat';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: #ededed;
      display: flex; flex-direction: column;
      font-family: -apple-system, "PingFang SC", sans-serif;
    `;
    overlay.innerHTML = `
      <div id="qt-fanwall-wx-header" style="background: #ededed; border-bottom: 1px solid #dcdcdc; padding: 14px 16px; display: flex; align-items: center; justify-content: center; gap:8px; position: relative;">
        <img src="${avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;">
        <div id="qt-fanwall-wx-header-text" style="font-size: 14px; font-weight: 600; color: #64748b;">
          <span class="qt-fanwall-pulse">对方正在输入中</span>
          <span class="qt-fanwall-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
      <div class="qt-fanwall-wx-body" style="flex: 1; overflow-y: auto; padding: 16px 12px; background: #ededed;"></div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  // 页头从"对方正在输入中…"切换为角色名
  function switchWeChatHeader(overlay, char, started) {
    const headerText = overlay.querySelector('#qt-fanwall-wx-header-text');
    if (headerText) {
      headerText.innerHTML = `<span style="color:#1a1a1a;">${escapeHtml(char.name)}</span>`;
    }
  }

  function playWeChatMessages(overlay, msgList, char) {
    return new Promise(async (resolve) => {
      const body = overlay.querySelector('.qt-fanwall-wx-body');
      for (let i = 0; i < msgList.length; i++) {
        const text = String(msgList[i] || '').trim();
        if (!text) continue;
        // 显示"对方正在输入..."气泡
        const typing = document.createElement('div');
        typing.className = 'qt-fanwall-typing';
        typing.style.cssText = 'display: flex; justify-content: flex-start; margin-bottom: 10px;';
        typing.innerHTML = `
          <div style="background: #fff; padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #999; display: inline-block;">
            <span class="qt-dot" style="display:inline-block; width:6px; height:6px; background:#999; border-radius:50%; margin:0 2px; animation: qt-fanwall-bounce 1s infinite;"></span>
            <span class="qt-dot" style="display:inline-block; width:6px; height:6px; background:#999; border-radius:50%; margin:0 2px; animation: qt-fanwall-bounce 1s infinite 0.2s;"></span>
            <span class="qt-dot" style="display:inline-block; width:6px; height:6px; background:#999; border-radius:50%; margin:0 2px; animation: qt-fanwall-bounce 1s infinite 0.4s;"></span>
          </div>
        `;
        body.appendChild(typing);
        body.scrollTop = body.scrollHeight;
        await sleep(1200 + Math.random() * 1300);
        typing.remove();
        // 显示消息气泡
        const bubble = document.createElement('div');
        bubble.style.cssText = 'display: flex; justify-content: flex-start; margin-bottom: 10px; opacity: 0; transition: opacity 0.4s;';
        bubble.innerHTML = `
          <div style="background: #fff; padding: 10px 14px; border-radius: 6px; font-size: 15px; color: #1a1a1a; max-width: 75%; line-height: 1.5; position: relative;">
            <span style="position: absolute; left: -5px; top: 12px; width: 0; height: 0; border-style: solid; border-width: 6px 6px 6px 0; border-color: transparent #fff transparent transparent;"></span>
            ${escapeHtml(text)}
          </div>
        `;
        body.appendChild(bubble);
        requestAnimationFrame(() => { bubble.style.opacity = '1'; });
        body.scrollTop = body.scrollHeight;
        await sleep(800 + text.length * 30);
      }
      resolve();
    });
  }

  function showArchiveOrDeepen(overlay) {
    return new Promise((resolve) => {
      const bar = document.createElement('div');
      bar.style.cssText = 'padding: 16px; background: #f7f7f7; border-top: 1px solid #dcdcdc; display: flex; gap: 12px; justify-content: center;';
      bar.innerHTML = `
        <button id="qt-fanwall-archive" style="flex: 1; padding: 12px; border: 1px solid #dcdcdc; background: #fff; color: #1a1a1a; border-radius: 6px; font-size: 15px; cursor: pointer;">归档</button>
        <button id="qt-fanwall-deepen" style="flex: 1; padding: 12px; border: none; background: #07c160; color: #fff; border-radius: 6px; font-size: 15px; cursor: pointer;">深入</button>
      `;
      overlay.appendChild(bar);
      document.getElementById('qt-fanwall-archive').onclick = () => { resolve('archive'); };
      document.getElementById('qt-fanwall-deepen').onclick = () => { resolve('deepen'); };
    });
  }

  // ============================================================
  // 7. 深入：角色进入档案馆与聊天列表
  // ============================================================
  async function deepenCharacter(game, worldview, identity, char, messages, summaries, dialogMsgs) {
    const internals = getInternals();
    const clean = internals.qtCleanTagsForContext;

    const summaryText = summaries.map(s => '第' + s.round + '轮：' + (s.plotShift || '') + '；' + (s.relationshipChanges || '')).join('\n');
    const earlyMsgs = messages.slice(0, 6).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 120)).join('\n');
    const lateMsgs = messages.slice(-6).map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + clean(String(m.content || '')).slice(0, 120)).join('\n');

    let journey = '';
    try {
      const journeyPrompt = `请用第二人称"你"概括以下角色在本次文游中的历程，200-400字，侧重其与玩家的关系变化和关键事件：

【角色】${char.name}（${char.identity || ''}）
【开端】${earlyMsgs}
【结局】${lateMsgs}
【总结】${summaryText}

直接输出历程描述，不要标题。`;
      journey = await internals.qtCallAI([{ role: 'user', content: journeyPrompt }], { temperature: 0.7, max_tokens: 600 });
    } catch (e) {
      journey = summaryText.slice(0, 400);
    }

    const persona = `【角色身份】${char.identity || ''}

【世界观背景】
${worldview.worldBackground || worldview.synopsis || ''}

【本次文游历程】
${journey}

【跨越世界线的记忆】
此角色来自快穿局剧本《${game.title || worldview.title || ''}》。在剧本完结时打破了第四面墙，跨越世界线与玩家重逢。以上是其在本世界线中与玩家共同经历的故事，角色对此保留完整记忆。`;

    // 重名检查：加 (n) 后缀
    const existingChars = await db.archives.where('name').startsWith(char.name).toArray();
    let finalName = char.name;
    if (existingChars.length > 0) {
      let maxN = 0;
      existingChars.forEach(c => {
        const m = String(c.name).match(/\((\d+)\)$/);
        if (m) maxN = Math.max(maxN, parseInt(m[1]));
      });
      finalName = `${char.name}(${maxN + 1})`;
    }

    // 头像：优先用角色自带头像，否则生成首字头像
    const finalAvatar = char.avatar || generateInitialAvatar(finalName);

    const newCharId = await db.archives.add({
      type: 'character',
      name: finalName,
      avatar: finalAvatar,
      remark: `来自快穿局·${worldview.title || ''}`,
      group: '快穿局·故人',
      persona: persona,
      parentId: null
    });

    const wbEntryId = await db.world_book_entries.add({
      group: `快穿局·${finalName}`,
      title: `${finalName}的世界观背景`,
      mode: 'constant',
      keywords: '',
      probability: 100,
      depth: 4,
      content: `【世界观】${worldview.title || ''}\n${worldview.worldBackground || ''}\n\n【角色身份】${char.identity || ''}\n\n【文游历程】${journey}`,
      isActive: true
    });

    const userIdNum = Number(localStorage.getItem("active_me_id") || 0);
    if (!userIdNum || isNaN(userIdNum)) {
      showToast(`${finalName} 已加入档案馆，请先在"我的"选择面具后再开启对话`);
      return;
    }
    const user = await db.archives.get(userIdNum);
    const sess = {
      userId: userIdNum,
      charId: newCharId,
      customCharName: finalName,
      customCharAvatar: finalAvatar,
      customCharPersona: persona,
      customUserName: user?.name || "我",
      customUserAvatar: user?.avatar || null,
      customUserPersona: user?.persona || "",
      lastMessageTime: Date.now(),
      mountedEntryIds: [wbEntryId]
    };
    sess.id = await db.sessions.add(sess);

    // 写入第四面墙对话消息（不携带思维链）
    for (let i = 0; i < dialogMsgs.length; i++) {
      const text = String(dialogMsgs[i] || '').trim();
      if (!text) continue;
      await db.messages.add({
        sessionId: sess.id,
        senderType: 'char',
        senderId: 0,
        content: text,
        contentType: 'text',
        timestamp: Date.now() - (dialogMsgs.length - i) * 1000,
        isFavorite: 0
      });
    }

    showToast(`${finalName} 已加入聊天列表与档案馆`);
  }

  // ============================================================
  // 8. 工具函数
  // ============================================================
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function showToast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
    } else {
      console.log('[Fanwall]', msg);
    }
  }

  // 注入动画 keyframes（一次性）
  if (!document.getElementById('qt-fanwall-style')) {
    const style = document.createElement('style');
    style.id = 'qt-fanwall-style';
    style.textContent = `
      @keyframes qt-fanwall-bounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
        30% { transform: translateY(-6px); opacity: 1; }
      }
      @keyframes qt-fanwall-pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
      .qt-fanwall-pulse { animation: qt-fanwall-pulse 1.8s ease-in-out infinite; }
      .qt-fanwall-dots span {
        display: inline-block;
        animation: qt-fanwall-bounce 1.4s infinite;
      }
      .qt-fanwall-dots span:nth-child(2) { animation-delay: 0.2s; }
      .qt-fanwall-dots span:nth-child(3) { animation-delay: 0.4s; }
    `;
    document.head.appendChild(style);
  }

})();
