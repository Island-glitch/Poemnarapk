/**
 * ============================================================
 * app_chat_social_actions.js - 叙事诗小手机：社交动作集成模块
 * ------------------------------------------------------------
 * 职责：
 *   1. 自动发朋友圈：prompt 注入 + [AUTO_MOMENT] 指令检测 + 执行 + 系统消息
 *   2. 论坛漫游：prompt 注入 + [FORUM_POST] / [FORUM_ALT_CREATE] 指令检测 + 执行 + 系统消息
 *   3. 朋友圈历史并入聊天上下文（含互动评论，按时间排序）
 *   4. 论坛帖子历史并入聊天上下文（char 发的帖子及评论）
 *   5. char 小号管理（最多 3 个，prompt 中告知可选身份）
 *
 * 指令格式：
 *   [AUTO_MOMENT: 内容文本] - char 自动发一条朋友圈
 *   [FORUM_POST: title|content] - char 用当前身份在论坛发帖
 *   [FORUM_POST_ALT: altId|title|content] - char 用指定小号在论坛发帖
 *   [FORUM_ALT_CREATE: nickname|signature] - char 建立一个新的论坛小号
 *
 * 系统消息样式：senderType='system'，content 为简短描述
 * ============================================================
 */
(function () {
  "use strict";

  window.socialActions = {
    // 小号上限
    MAX_ALT_ACCOUNTS: 3,

    // ---------- 1. Prompt 构建 ----------
    /**
     * 构建"自动发朋友圈"prompt 段落
     * 仅在 sess.allowCharAutoMoment === 1 时返回内容
     */
    buildAutoMomentPromptSegment: async function (sessionId) {
      const sess = await db.sessions.get(sessionId);
      if (!sess || sess.allowCharAutoMoment !== 1) return "";

      const char = await db.archives.get(sess.charId);
      const charName = sess.customCharName || char?.name || "对方";

      // 统计 char 最近的朋友圈动态数量（让 AI 知道自己发过多少）
      const myMoments = await db.moments
        .where("senderId").equals(sess.charId)
        .toArray();

      return `【自动发朋友圈特权】
你现在被允许在聊天过程中自发地发布朋友圈动态。当你觉得此刻的心情、见闻或生活片段适合发朋友圈时（例如看到美景、吃到美食、心情起伏、想分享某个瞬间），可以在回复末尾单独占一行输出指令：
- 发朋友圈指令格式：[AUTO_MOMENT: 朋友圈文本内容]
内容可以是文字，也可以包含 [MOMENT_IMAGE: 图片白描描述] 标记来附带图片。
发布后系统会以系统消息形式通知对方"你发了一条朋友圈"，朋友圈下的互动（点赞/评论）也会被其他角色触发。
你目前作为 [${charName}] 已经发布了 ${myMoments.length} 条朋友圈动态。
注意：不要每次回复都发朋友圈，只在真正合适的时机偶尔发布。其余正常对白照常输出。`;
    },

    /**
     * 构建"论坛漫游"prompt 段落
     * 仅在 sess.allowCharForumRoam === 1 时返回内容
     */
    buildForumRoamPromptSegment: async function (sessionId) {
      const sess = await db.sessions.get(sessionId);
      if (!sess || sess.allowCharForumRoam !== 1) return "";

      const char = await db.archives.get(sess.charId);
      const charName = sess.customCharName || char?.name || "对方";

      // 获取当前论坛激活账户
      const activeAccountId = localStorage.getItem("forum_active_account_id");
      if (!activeAccountId) return "";

      // 查找 char 名下所有论坛分身（含主号），按 id 升序
      const allAccounts = await db.forum_npc_accounts
        .where("charId").equals(sess.charId)
        .toArray()
        .then(list => list
          .filter(n => Number(n.userId) === Number(activeAccountId))
          .sort((a, b) => Number(a.id) - Number(b.id)));

      const allowAlt = sess.allowCharForumAltAccount === 1;
      const totalCount = allAccounts.length;
      const mainAccount = allAccounts[0] || null;
      const altAccounts = allAccounts.slice(1); // 第一个之后都算小号

      // 列出所有可用身份
      let identityList = "";
      if (totalCount > 0) {
        identityList = allAccounts.map((a, i) => {
          const tag = i === 0 ? "主号" : `小号${i}`;
          return `  ${i + 1}. [${tag}] @${a.username}（昵称：${a.nickname}，签名：${a.signature || "无"}）`;
        }).join("\n");
      }

      let altSection = "";
      if (allowAlt) {
        const altCount = altAccounts.length;
        const remaining = this.MAX_ALT_ACCOUNTS - totalCount;
        altSection = `
【论坛小号身份管理】
你当前共有 ${totalCount}/${this.MAX_ALT_ACCOUNTS} 个论坛分身（含主号）：
${identityList || "  （暂无分身，需先在论坛 NPC 管理中枢引入主号）"}
${remaining > 0 ? `你还可以建立 ${remaining} 个新小号。建立小号指令：[FORUM_ALT_CREATE: 昵称|个性签名]` : "你的分身已达上限，不能再建立新小号。"}
小号可以发一些大号不合适发的内容（如匿名倾诉、网络围观、跟帖对线等）。`;
      }

      return `【论坛漫游特权】
你现在被允许在聊天过程中自发地前往论坛发帖。当你觉得有想分享的话题、想吐槽的事情、或者想在论坛留下痕迹时，可以在回复末尾单独占一行输出指令：
- 用主号发帖：[FORUM_POST: 帖子标题|帖子正文]${mainAccount ? `（将使用 @${mainAccount.username} 身份）` : ""}
${allowAlt && totalCount > 0 ? `- 用指定身份发帖：[FORUM_POST_ALT: 身份序号|帖子标题|帖子正文]（身份序号为上面列表的编号 1~${totalCount}，1=主号，2+=小号）` : ""}
${altSection}
发帖后系统会以系统消息形式通知对方你在论坛发了帖子。
注意：不要每次回复都发帖，只在真正合适的时机偶尔发布。其余正常对白照常输出。`;
    },

    // ---------- 2. 朋友圈历史并入上下文 ----------
    /**
     * 构建 char 的朋友圈历史上下文（含互动），按时间排序
     * 无论 allowCharAutoMoment 是否开启，都并入上下文
     */
    buildMomentHistoryContext: async function (sessionId) {
      const sess = await db.sessions.get(sessionId);
      if (!sess) return "";

      const charId = sess.charId;
      const userIdNum = Number(sess.userId);

      // 取该 char 发的所有朋友圈动态
      const charMoments = await db.moments
        .where("senderId").equals(charId)
        .toArray();

      if (charMoments.length === 0) return "";

      // 按时间正序
      charMoments.sort((a, b) => a.timestamp - b.timestamp);

      // 取最近 8 条（避免上下文过长）
      const recent = charMoments.slice(-8);

      let lines = [];
      for (const m of recent) {
        const timeStr = this._formatTime(m.timestamp);
        let line = `[${timeStr}] 你发了一条朋友圈："${(m.content || "").substring(0, 80)}"`;
        if (m.images && m.images.length > 0) {
          line += `（含${m.images.length}张图片）`;
        }
        // 取互动
        const comments = await db.moment_comments
          .where("momentId").equals(m.id)
          .toArray();
        const likes = m.likes || [];
        if (likes.length > 0) {
          line += `，获赞${likes.length}个`;
        }
        if (comments.length > 0) {
          line += `，评论${comments.length}条：`;
          const commentLines = comments.slice(0, 5).map(async c => {
            const commenter = await db.archives.get(c.senderId);
            const cname = commenter?.name || "某人";
            return `    ${cname}：${(c.content || "").substring(0, 50)}`;
          });
          const resolved = await Promise.all(commentLines);
          line += "\n" + resolved.join("\n");
        }
        lines.push(line);
      }

      return `【你的朋友圈历史动态（按时间排序）】\n${lines.join("\n")}`;
    },

    // ---------- 3. 论坛帖子历史并入上下文 ----------
    /**
     * 构建 char 的论坛帖子历史上下文（含主号 + 所有小号发帖）
     */
    buildForumHistoryContext: async function (sessionId) {
      const sess = await db.sessions.get(sessionId);
      if (!sess || sess.allowCharForumRoam !== 1) return "";

      const charId = sess.charId;
      const activeAccountId = localStorage.getItem("forum_active_account_id");
      if (!activeAccountId) return "";

      // 查找 char 名下所有论坛分身（含主号），按 id 升序
      const allAccounts = await db.forum_npc_accounts
        .where("charId").equals(charId)
        .toArray()
        .then(list => list
          .filter(n => Number(n.userId) === Number(activeAccountId))
          .sort((a, b) => Number(a.id) - Number(b.id)));

      if (allAccounts.length === 0) return "";

      // 取所有分身发的帖子
      const accountIds = allAccounts.map(a => a.id);
      let allPosts = [];
      for (const accId of accountIds) {
        const posts = await db.forum_posts
          .where("authorId").equals(accId)
          .toArray();
        allPosts = allPosts.concat(posts);
      }

      if (allPosts.length === 0) return "";

      allPosts.sort((a, b) => a.createdAt - b.createdAt);
      const recent = allPosts.slice(-5);

      const lines = recent.map(p => {
        const acc = allAccounts.find(a => a.id === p.authorId);
        const accIdx = acc ? allAccounts.indexOf(acc) : -1;
        const tag = accIdx === 0 ? "主号" : (accIdx > 0 ? `小号${accIdx}` : "未知");
        const accName = acc ? `@${acc.username}(${tag})` : "未知";
        const timeStr = this._formatTime(p.createdAt);
        return `[${timeStr}] 你以 ${accName} 身份发了帖子《${(p.title || "").substring(0, 40)}》`;
      });

      return `【你的论坛发帖历史】\n${lines.join("\n")}`;
    },

    // ---------- 4. 指令检测与执行 ----------
    /**
     * 从 char 回复文本中检测并执行社交动作指令
     * 返回 { cleanedText, sysNotices }
     */
    detectAndExecute: async function (replyText, sessionId) {
      const sess = await db.sessions.get(sessionId);
      if (!sess) return { cleanedText: replyText, sysNotices: [] };

      const sysNotices = [];
      let cleaned = replyText;

      // 容错正则说明：AI 有时会漏掉指令结尾的 ]，
      // 因此每个指令提供两套正则：先严格匹配（含 ]），未命中再宽松匹配（到行尾/下一标签）。

      // 4.1 [AUTO_MOMENT: 内容]  /  [AUTO_MOMENT: 内容（漏 ]）
      let momentMatch = cleaned.match(/\[AUTO_MOMENT:\s*([\s\S]*?)\]/i);
      if (!momentMatch) {
        momentMatch = cleaned.match(/\[AUTO_MOMENT:\s*([^\[\]]*(?:\n(?!\s*\[)[^\[\]]*)*)/i);
      }
      if (momentMatch && sess.allowCharAutoMoment === 1) {
        const momentContent = momentMatch[1].trim();
        if (momentContent) {
          const result = await this._executeAutoMoment(sess, momentContent);
          sysNotices.push(result.notice);
        }
        cleaned = cleaned.replace(momentMatch[0], "").trim();
      }

      // 4.2 [FORUM_ALT_CREATE: 昵称|签名]
      let altCreateMatch = cleaned.match(/\[FORUM_ALT_CREATE:\s*([^\]]+)\]/i);
      if (!altCreateMatch) {
        altCreateMatch = cleaned.match(/\[FORUM_ALT_CREATE:\s*([^\[\]\n]+)/i);
      }
      if (altCreateMatch && sess.allowCharForumRoam === 1 && sess.allowCharForumAltAccount === 1) {
        const parts = altCreateMatch[1].split("|").map(s => s.trim());
        const nickname = parts[0] || "匿名旅人";
        const signature = parts[1] || "";
        const result = await this._executeForumAltCreate(sess, nickname, signature);
        sysNotices.push(result.notice);
        cleaned = cleaned.replace(altCreateMatch[0], "").trim();
      }

      // 4.3 [FORUM_POST_ALT: 序号|标题|正文]
      let postAltMatch = cleaned.match(/\[FORUM_POST_ALT:\s*(\d+)\s*\|\s*([^\]]+)\]/i);
      if (!postAltMatch) {
        postAltMatch = cleaned.match(/\[FORUM_POST_ALT:\s*(\d+)\s*\|\s*([^\[\]\n]+)/i);
      }
      if (postAltMatch && sess.allowCharForumRoam === 1) {
        const altIdx = parseInt(postAltMatch[1]) - 1;
        const postParts = postAltMatch[2].split("|").map(s => s.trim());
        const title = postParts[0] || "日常随笔";
        const content = postParts.slice(1).join("|") || "...";
        const result = await this._executeForumPost(sess, title, content, altIdx);
        sysNotices.push(result.notice);
        cleaned = cleaned.replace(postAltMatch[0], "").trim();
      }

      // 4.4 [FORUM_POST: 标题|正文]（大号发帖，用第一个小号身份）
      let postMatch = cleaned.match(/\[FORUM_POST:\s*([^\]]+)\]/i);
      if (!postMatch) {
        postMatch = cleaned.match(/\[FORUM_POST:\s*([^\[\]\n]+)/i);
      }
      if (postMatch && sess.allowCharForumRoam === 1) {
        const postParts = postMatch[1].split("|").map(s => s.trim());
        const title = postParts[0] || "日常随笔";
        const content = postParts.slice(1).join("|") || "...";
        const result = await this._executeForumPost(sess, title, content, 0);
        sysNotices.push(result.notice);
        cleaned = cleaned.replace(postMatch[0], "").trim();
      }

      return { cleanedText: cleaned, sysNotices };
    },

    // ---------- 5. 执行函数 ----------
    /**
     * 执行发朋友圈
     */
    _executeAutoMoment: async function (sess, rawContent) {
      try {
        // 解析图片标记：兼容 [MOMENT_IMAGE: 描述] / [图片描述: 描述] / [图片: 描述]
        const images = [];
        let textContent = rawContent
          .replace(/\[MOMENT_IMAGE:\s*([^\]]*)\]/gi, (m, desc) => {
            images.push({ url: "", desc: desc.trim() || "图片" });
            return "";
          })
          .replace(/[\[【]\s*图片描述\s*[:：]\s*([^\]】]*?)[\]】]/gi, (m, desc) => {
            images.push({ url: "", desc: desc.trim() || "图片" });
            return "";
          })
          .replace(/[\[【]\s*图片\s*[:：]\s*([^\]】]*?)[\]】]/gi, (m, desc) => {
            images.push({ url: "", desc: desc.trim() || "图片" });
            return "";
          })
          .trim();

        const charId = sess.charId;
        const userIdNum = Number(sess.userId);

        // 可见范围：同分组角色
        const char = await db.archives.get(charId);
        const group = char?.group || "";
        const allChars = await db.archives.where("type").equals("character").toArray();
        const sameGroupCharIds = allChars
          .filter(c => c.id !== charId && (c.group || "") === group)
          .map(c => c.id);

        const momentId = await db.moments.add({
          userId: userIdNum,
          senderType: "char",
          senderId: charId,
          content: textContent,
          images: images,
          likes: [],
          visibleCharIds: sameGroupCharIds,
          timestamp: Date.now()
        });

        // 朋友圈生图触发：若该会话已开启朋友圈生图，对每张图片异步生成实际图像
        // 生成完成后回填 images 中的 url 字段，并更新 moments 表
        if (images.length && window.imageGenSystem && typeof window.imageGenSystem.triggerImageGeneration === 'function') {
          const sessionId = sess.id || (typeof activeSessionId !== 'undefined' ? activeSessionId : null);
          if (sessionId) {
            // 用朋友圈正文作为上下文（推断主题，不能 OOC）
            const aiText = textContent + ' ' + images.map(i => i.desc).join(' ');
            images.forEach((img, idx) => {
              window.imageGenSystem.triggerImageGeneration({
                sessionId: sessionId,
                scene: 'moments',
                aiText: aiText + (idx > 0 ? ' ' + img.desc : ''),
                onComplete: async (result) => {
                  if (!result) return;
                  try {
                    const thumb = (typeof result === 'object' && result.thumb) ? result.thumb : (typeof result === 'string' ? result : '');
                    const hd = (typeof result === 'object' && result.hd) ? result.hd : (typeof result === 'string' ? result : '');
                    const moment = await db.moments.get(momentId);
                    if (!moment || !Array.isArray(moment.images)) return;
                    if (idx < moment.images.length) {
                      moment.images[idx] = { url: thumb, hdUrl: hd, desc: moment.images[idx].desc, generated: true };
                      await db.moments.update(momentId, { images: moment.images });
                    }
                  } catch (e) {
                    console.warn('朋友圈生图回填失败:', e);
                  }
                }
              });
            });
          }
        }

        // 触发级联反应（异步，不阻塞）
        if (window.momentSystem && typeof window.momentSystem.triggerAIsFeedbacksOnPost === "function") {
          setTimeout(() => {
            window.momentSystem.triggerAIsFeedbacksOnPost(momentId, sameGroupCharIds);
          }, 100);
        }

        return { notice: { type: 'moment', targetId: momentId, charName: sess.customCharName || char?.name || "对方", summary: textContent.substring(0, 40) + (textContent.length > 40 ? "..." : "") } };
      } catch (e) {
        return { notice: "[朋友圈发布失败]" };
      }
    },

    /**
     * 执行建立论坛小号
     * 上限检查：每个 char 最多 MAX_ALT_ACCOUNTS 个论坛分身（含主号）
     */
    _executeForumAltCreate: async function (sess, nickname, signature) {
      try {
        const activeAccountId = localStorage.getItem("forum_active_account_id");
        if (!activeAccountId) {
          return { notice: "[论坛未初始化，无法建立小号]" };
        }

        // 检查分身上限（含主号在内最多 MAX_ALT_ACCOUNTS 个）
        const existingAccounts = await db.forum_npc_accounts
          .where("charId").equals(sess.charId)
          .toArray()
          .then(list => list.filter(n => Number(n.userId) === Number(activeAccountId)));

        if (existingAccounts.length >= this.MAX_ALT_ACCOUNTS) {
          return { notice: `[论坛分身已达上限(${this.MAX_ALT_ACCOUNTS}个，含主号)，无法建立新小号]` };
        }

        const char = await db.archives.get(sess.charId);
        // 生成用户名
        const username = "alt_" + Math.random().toString(36).substring(2, 8);
        // 生成炫彩头像
        let avatar = "";
        if (typeof forumGenerateColorfulAvatar === "function") {
          avatar = forumGenerateColorfulAvatar(nickname);
        }

        const npcId = await db.forum_npc_accounts.add({
          userId: Number(activeAccountId),
          charId: sess.charId,
          nickname: nickname,
          avatar: avatar,
          username: username,
          signature: signature,
          postFrequency: "自主发帖",
          postPreference: "匿名身份",
          postProbability: 30
        });

        // 自动关注这个小号
        await db.forum_follows.add({
          followerId: Number(activeAccountId),
          followeeId: npcId,
          createdAt: Date.now()
        });

        return { notice: { type: 'forum_alt_create', targetId: npcId, charName: sess.customCharName || char?.name || "对方", username: username, nickname: nickname } };
      } catch (e) {
        return { notice: "[论坛小号建立失败]" };
      }
    },

    /**
     * 执行论坛发帖
     * altIdx: 0 = 主号发帖；1+ = 第 N 个小号发帖
     */
    _executeForumPost: async function (sess, title, content, altIdx) {
      try {
        const activeAccountId = localStorage.getItem("forum_active_account_id");
        if (!activeAccountId) {
          return { notice: "[论坛未初始化，无法发帖]" };
        }

        // 获取 char 名下所有论坛分身（含主号），按 id 升序
        const altAccounts = await db.forum_npc_accounts
          .where("charId").equals(sess.charId)
          .toArray()
          .then(list => list
            .filter(n => Number(n.userId) === Number(activeAccountId))
            .sort((a, b) => Number(a.id) - Number(b.id)));

        if (altAccounts.length === 0) {
          // 没有任何论坛分身：提示 user 先在 NPC 管理中枢引入分身
          return { notice: "[论坛发帖失败：你还没有论坛分身，请先在论坛 NPC 管理中枢引入分身]" };
        }

        const targetAlt = altAccounts[altIdx] || altAccounts[0];
        if (!targetAlt) {
          return { notice: "[论坛发帖失败：找不到指定小号]" };
        }

        const postId = await db.forum_posts.add({
          authorId: targetAlt.id,
          isNpc: 1,
          title: title,
          content: content,
          media: "",
          createdAt: Date.now(),
          views: Math.floor(Math.random() * 20) + 3,
          likesCount: 0,
          commentsCount: 0,
          forwardsCount: 0
        });

        const char = await db.archives.get(sess.charId);
        const charName = sess.customCharName || char?.name || "对方";
        const roleLabel = altIdx === 0 ? "主号" : `小号${altIdx}`;
        return { notice: { type: 'forum_post', targetId: postId, charName: charName, roleLabel: roleLabel, username: targetAlt.username, title: title.substring(0, 30) } };
      } catch (e) {
        return { notice: "[论坛发帖失败]" };
      }
    },

    // ---------- 6. 系统消息写入 ----------
    /**
     * 将系统消息写入 db.messages 并上屏
     * notice 可以是字符串（纯文本）或对象 { type, targetId, ... }（跳转卡片）
     */
    writeSysNoticeToChat: async function (sessionId, notice) {
      try {
        let content;
        let contentType = "text";
        if (typeof notice === 'object' && notice !== null) {
          content = JSON.stringify(notice);
          contentType = "social_notice";
        } else {
          content = String(notice);
        }
        await db.messages.add({
          sessionId: sessionId,
          senderType: "system",
          senderId: 0,
          content: content,
          contentType: contentType,
          timestamp: Date.now()
        });
        // 刷新聊天界面
        if (typeof renderDialogMessages === "function") {
          renderDialogMessages();
        }
      } catch (e) { /* 静默 */ }
    },

    // ---------- 7. 辅助 ----------
    _formatTime: function (ts) {
      const d = new Date(ts);
      const mm = (d.getMonth() + 1).toString().padStart(2, "0");
      const dd = d.getDate().toString().padStart(2, "0");
      const hh = d.getHours().toString().padStart(2, "0");
      const mi = d.getMinutes().toString().padStart(2, "0");
      return `${mm}-${dd} ${hh}:${mi}`;
    }
  };
})();
