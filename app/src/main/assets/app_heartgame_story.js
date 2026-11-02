/**
 * app_heartgame_story.js - 心动游戏 · 沉浸式互动剧情引擎 (S)
 * ============================================================================
 * 职责：
 *   1. 视听演播架构：背景图层 + 立绘图层（Live2D 表情/动作实时驱动）
 *      + 乙游定制半透明磨砂叙事窗；角色对白用带微缩印记与个性化色调的气泡边框
 *   2. 剧情中途小手机：剧情进程中可动态呼出手机界面，承载
 *      剧情内短讯（SMS）/ 假朋友圈互动 / 剧情内电话接入
 *   3. 双向剧情驱动：
 *      · 攻略模式 —— 系统/Char 出题，User 选二/三分支，并保留底层自定义行为输入框
 *        （用户键入自由动作，AI 动态推演 Char 反应）
 *      · 反向模式 —— 主线节点停顿时由 User 设定 2~3 个抉择项并附带属性奖惩
 *        （如 [选项A: 顺从 +好感5] [选项B: 拒绝 -好感2]），Char 基于性格模型自主选择
 *   4. 多主线会话管理：并行开启多个篇章 + 存档点（Save/Load）+ 分支树回溯
 *
 * 依赖：window.HeartGame.K / .H / .U / .C（app_heartgame_core.js）
 *      可选：window.HeartGame.Portraits（立绘渲染）
 */
(function () {
  'use strict';

  var HG = window.HeartGame;

  // ==========================================================================
  //  0. 剧本分镜（纯函数，可在 Node 里直接单测）
  //     用户要求：「对话框过于复杂了，我们要透明化，字体缩小一些，并且做好段落切分，
  //                基本一句话一个分镜，角色说话要单独分镜。」
  // ==========================================================================

  var Script = {
    /** 一句话的结束标点（保留标点，切在标点之后） */
    SENT_END: /[。！？!?…；;]+["'」』”’）)]*/g,

    /**
     * 把一段原文切成"分镜"。
     * 规则：
     *   1. 「…」/ “… ” 里的内容 = 角色台词（单独一个分镜，带说话人）
     *   2. 其余 = 旁白
     *   3. 旁白与台词都再按句末标点切，**一句话一个分镜**
     *   4. 太短的碎句（<=2 字）并进上一句；过长的句子（>60 字）按逗号再切一刀
     * @returns {Array<{kind:'narration'|'speech', text:string}>}
     */
    splitSegments: function (text) {
      var raw = String(text == null ? '' : text).replace(/\r/g, '');
      if (!raw.trim()) return [];
      var out = [];

      var pushNarration = function (s) {
        var t = String(s).trim();
        if (!t) return;
        Script._sentences(t).forEach(function (one) {
          var prev = out[out.length - 1];
          if (prev && prev.kind === 'narration' && one.length <= 2) {
            prev.text += one;              // 「……。」这种碎句并进上一句
          } else {
            out.push({ kind: 'narration', text: one });
          }
        });
      };
      var pushSpeech = function (s) {
        var t = String(s).trim();
        if (!t) return;
        Script._sentences(t).forEach(function (one) {
          out.push({ kind: 'speech', text: one });
        });
      };

      // 先按行处理，再在行内挑出台词
      raw.split('\n').forEach(function (line) {
        var src = line.trim();
        if (!src) return;
        // 「…」或 “…” 交替匹配
        var re = /[「“]([^」”]*)[」”]/g;
        var last = 0, m;
        while ((m = re.exec(src)) !== null) {
          if (m.index > last) pushNarration(src.slice(last, m.index));
          pushSpeech(m[1]);
          last = re.lastIndex;
        }
        if (last < src.length) pushNarration(src.slice(last));
      });

      return out.length ? out : [{ kind: 'narration', text: raw.trim() }];
    },

    /** 把一段旁白按句末标点切成若干句（过长再按逗号补一刀） */
    _sentences: function (t) {
      var parts = [];
      var buf = '';
      for (var i = 0; i < t.length; i++) {
        buf += t[i];
        if ('。！？!?…'.indexOf(t[i]) >= 0) {
          // 把连续的标点一起吃进来
          while (i + 1 < t.length && '。！？!?…；;'.indexOf(t[i + 1]) >= 0) { buf += t[++i]; }
          parts.push(buf.trim());
          buf = '';
        }
      }
      if (buf.trim()) parts.push(buf.trim());

      var out = [];
      parts.forEach(function (p) {
        if (p.length <= 60) { out.push(p); return; }
        // 太长：按逗号再切，每段尽量不超过 34 字
        var acc = '';
        p.split('，').forEach(function (chunk, idx, arr) {
          acc += chunk + (idx < arr.length - 1 ? '，' : '');
          if (acc.length >= 34) { out.push(acc.trim()); acc = ''; }
        });
        if (acc.trim()) out.push(acc.trim());
      });
      return out.filter(function (s) { return s.length > 0; });
    },

    /** 这一段是不是"小手机"剧情（需要用户在手机里回应） */
    isPhoneKind: function (kind) {
      return kind === 'sms' || kind === 'call' || kind === 'moment';
    }
  };
  if (!HG) { console.warn('[心动游戏] core 未加载，剧情引擎已跳过'); return; }
  var K = HG.K, H = HG.H, U = HG.U, C = HG.C;

  // ==========================================================================
  //  1. 数据层：作品（书）/ 章节 / 节点 / 分支树 / 存档点
  //
  //  v1.5.49 小说化重做。用户原话：「一个主线应该是像小说一样，一个主线名，
  //  然后分章节体验，章节都可以继续生成……整部作品一条线，书架式构图，多个作品。」
  //
  //  心智模型（和旧版最大的区别）：
  //    Book（作品）  = 一部作品 = 一条线 = 小手机里的一整段关系
  //    Chapter（章节）= 一次生成的一批节点，**读完不算完**，可以一直「继续写下一章」
  //  旧版把「篇章」当成一次性消耗品，所以永远读不完也接不上。
  // ==========================================================================

  /** 一个值像不像「作品」：有 chapters 数组 */
  function looksLikeBook(x) {
    return !!x && typeof x === 'object' && Array.isArray(x.chapters);
  }

  /** 一个值像不像「章节」：没有 chapters，但有节点数组 */
  function looksLikeChapter(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x.chapters) && Array.isArray(x.nodes);
  }

  var Book = {

    all: function () {
      var st = K.state;
      if (!st || !st.story || !Array.isArray(st.story.books)) return [];
      return st.story.books;
    },

    byId: function (id) {
      if (!id) return null;
      var list = Book.all();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      // 兼容：传进来的可能是「章节 id」（旧调用点只知道 arcId）
      for (var j = 0; j < list.length; j++) {
        var chs = list[j].chapters || [];
        for (var k = 0; k < chs.length; k++) if (chs[k].id === id) return list[j];
      }
      return null;
    },

    /** 书名（找不到时给一个体面的兜底，UI 不需要再判空） */
    titleOf: function (book) {
      var b = Book.resolve(book);
      return (b && b.title) || '未命名作品';
    },

    /** 接受 作品对象 / 作品 id / 章节 / 章节 id，统一解析成作品 */
    resolve: function (x) {
      if (!x) return null;
      if (looksLikeBook(x)) return x;
      if (typeof x === 'string') return Book.byId(x);
      if (looksLikeChapter(x)) {
        var owner = Book.byId(x.bookId);
        if (owner) return owner;
        var all = Book.all();
        for (var i = 0; i < all.length; i++) {
          if ((all[i].chapters || []).some(function (c) { return c === x; })) return all[i];
        }
      }
      return null;
    },

    /** 当前作品；没有任何作品时返回 null */
    active: function () {
      var st = K.state;
      if (!st) return null;
      return Book.byId(st.story.activeBookId) || Book.all()[0] || null;
    },

    setActive: function (id) {
      var st = K.state;
      if (!st) return false;
      var b = Book.byId(id);
      if (!b) return false;
      st.story.activeBookId = b.id;
      var chs = b.chapters || [];
      if (!st.story.activeChapterId || !chs.some(function (c) { return c.id === st.story.activeChapterId; })) {
        st.story.activeChapterId = chs.length ? chs[chs.length - 1].id : null;
      }
      K.save();
      return true;
    },

    /**
     * 新建一部作品
     * @param {object} cfg {title, synopsis, cover, theme, styleId, chapters}
     */
    create: function (cfg) {
      var st = K.state;
      if (!st) return null;
      var c = cfg || {};
      var now = Date.now();
      var book = {
        id: U.uid('book'),
        title: String(c.title || '未命名作品').slice(0, 40),
        synopsis: String(c.synopsis || ''),
        cover: c.cover || '',
        theme: c.theme || '',
        styleId: (c.styleId === undefined ? null : c.styleId),
        migrated: !!c.migrated,
        chapters: Array.isArray(c.chapters) ? c.chapters : [],
        createdAt: now,
        updatedAt: now
      };
      st.story.books.unshift(book);
      st.story.activeBookId = book.id;
      st.story.activeChapterId = book.chapters.length ? book.chapters[0].id : null;
      K.pushTimeline({ type: 'story', title: '新作品上架', text: '「' + book.title + '」开始了。' });
      K.save(true);
      K.emit('story', { book: book });
      return book;
    },

    /** 删除一部作品：连带它的章节与小手机记录一起清掉 */
    remove: function (id) {
      var st = K.state;
      var b = Book.byId(id);
      if (!st || !b) return false;
      st.story.books = Book.all().filter(function (x) { return x.id !== b.id; });
      try { SubPhone.purgeBook(b.id); } catch (e) { }
      if (st.story.activeBookId === b.id) {
        var rest = Book.all();
        st.story.activeBookId = rest.length ? rest[0].id : null;
        var chs = (rest[0] && rest[0].chapters) || [];
        st.story.activeChapterId = chs.length ? chs[chs.length - 1].id : null;
      }
      K.save(true);
      return true;
    },

    touch: function (book) {
      var b = Book.resolve(book);
      if (!b) return false;
      b.updatedAt = Date.now();
      K.save();
      return true;
    },

    /** 已读完的章节数 */
    finishedCount: function (book) {
      var b = Book.resolve(book);
      if (!b) return 0;
      return (b.chapters || []).filter(function (c) { return c.status === 'finished'; }).length;
    },

    /** 整部作品的阅读进度（所有章节的节点进度按节点总数加权） */
    progress: function (book) {
      var b = Book.resolve(book);
      if (!b) return 0;
      var total = 0, done = 0;
      (b.chapters || []).forEach(function (c) {
        var n = (c.nodes || []).length;
        total += n;
        done += (c.status === 'finished') ? n : Math.min(n, U.int(c.nodeIndex, 0));
      });
      return total ? U.pct(done, total) : 0;
    },

    /** 「继续写下一章」要用的信息：下一章是第几章 / 上一章的标题与梗概 */
    continueInfo: function (book) {
      var b = Book.resolve(book);
      if (!b) return null;
      var list = b.chapters || [];
      var last = list.length ? list[list.length - 1] : null;
      return {
        index: list.length,
        lastTitle: last ? last.title : '',
        lastSynopsis: last ? (last.synopsis || '') : '',
        count: list.length
      };
    }
  };

  var Chapter = {

    list: function (book) {
      var b = Book.resolve(book);
      return (b && b.chapters) || [];
    },

    byId: function (id) {
      if (!id) return null;
      var list = Book.all();
      for (var i = 0; i < list.length; i++) {
        var chs = list[i].chapters || [];
        for (var j = 0; j < chs.length; j++) if (chs[j].id === id) return chs[j];
      }
      return null;
    },

    /** 兼容旧签名的解析：Chapter.resolve(chapterLike, bookLike) */
    resolve: function (x, bookLike) {
      if (!x) return null;
      if (typeof x === 'string') return Chapter.byId(x);
      if (looksLikeBook(x)) {
        var b = x;
        var list = b.chapters || [];
        var picked = null;
        if (looksLikeChapter(bookLike)) picked = bookLike;
        else if (typeof bookLike === 'string') picked = Chapter.byId(bookLike);
        if (picked && list.some(function (c) { return c === picked; })) return picked;
        var st = K.state;
        if (st && list.some(function (c) { return c.id === st.story.activeChapterId; })) {
          for (var i = 0; i < list.length; i++) if (list[i].id === st.story.activeChapterId) return list[i];
        }
        return list.length ? list[list.length - 1] : null;
      }
      if (looksLikeChapter(x)) return x;
      return null;
    },

    /** 当前章节（跟着 activeChapterId 走；activeChapterId 不在这本书里就取最后一章） */
    active: function (bookLike) {
      var st = K.state;
      var b = Book.resolve(bookLike) || Book.active();
      if (!b) return null;
      var list = b.chapters || [];
      if (!list.length) return null;
      if (bookLike === undefined && st) {
        for (var i = 0; i < list.length; i++) if (list[i].id === st.story.activeChapterId) return list[i];
        // activeChapterId 指向别的作品时不能返回 null —— 目录与演出都需要一个确定的章节
        return list[list.length - 1];
      }
      return list[list.length - 1];
    },

    /**
     * 往一部作品里追加一章（新生成 / 续写都走这里）
     * @param {object} bookLike 作品（或作品 id）
     * @param {object} cfg {title, synopsis, nodes, theme, id}
     */
    create: function (bookLike, cfg) {
      var st = K.state;
      var b = Book.resolve(bookLike);
      if (!st || !b) return null;
      var c = cfg || {};
      var now = Date.now();
      var list = b.chapters || (b.chapters = []);
      var ch = {
        id: c.id || U.uid('ch'),
        bookId: b.id,                      // 反向引用：章节自己知道属于哪部作品
        index: list.length,
        title: String(c.title || ('第 ' + (list.length + 1) + ' 章')),
        synopsis: String(c.synopsis || ''),
        nodes: Array.isArray(c.nodes) ? c.nodes : [],
        nodeIndex: 0,
        status: 'playing',                 // playing | finished
        saves: [],                         // 存档点（章节级）
        theme: c.theme || b.theme || '',
        sceneId: c.sceneId || null,
        tier: st.tierKey,
        mode: st.mode,
        createdAt: now,
        updatedAt: now
      };
      list.push(ch);
      b.updatedAt = now;
      st.story.activeBookId = b.id;
      st.story.activeChapterId = ch.id;
      K.pushTimeline({
        type: 'story',
        title: list.length > 1 ? '新章开写' : '作品开篇',
        text: '「' + b.title + '」第 ' + (ch.index + 1) + ' 章 · ' + ch.title
      });
      K.save(true);
      K.emit('story', { book: b, chapter: ch });
      return ch;
    },

    /** 删掉一章并把后面的章号重排（章号是阅读顺序，不能留空号） */
    remove: function (bookLike, chapterLike) {
      var st = K.state;
      var b = Book.resolve(bookLike);
      if (!st || !b) return false;
      var ch = (chapterLike === undefined) ? Chapter.active(b) : Chapter.resolve(chapterLike, b);
      if (!ch) return false;
      b.chapters = (b.chapters || []).filter(function (c) { return c !== ch && c.id !== ch.id; });
      b.chapters.forEach(function (c, i) { c.index = i; });
      try { SubPhone.purgeChapter(b.id, ch.id); } catch (e) { }
      if (st.story.activeChapterId === ch.id) {
        var list = b.chapters;
        st.story.activeChapterId = list.length ? list[list.length - 1].id : null;
      }
      b.updatedAt = Date.now();
      K.save(true);
      return true;
    },

    /** 当前节点 */
    node: function (chapterLike, bookLike) {
      var c = Chapter.resolve(chapterLike, bookLike);
      if (!c || !(c.nodes || []).length) return null;
      return c.nodes[U.clamp(U.int(c.nodeIndex, 0), 0, c.nodes.length - 1)] || null;
    },

    /**
     * 推进到下一节点。走完最后一个节点 = 本章读完（status 置 finished），
     * 但**作品没完** —— 用户可以「继续写下一章」。
     */
    advance: function (chapterLike, bookLike) {
      var c = Chapter.resolve(chapterLike, bookLike);
      if (!c) return null;
      var b = Book.byId(c.bookId) || Book.resolve(chapterLike);
      var list = (c.nodes || []).length;
      if (U.int(c.nodeIndex, 0) >= list - 1) {
        c.status = 'finished';
        c.updatedAt = Date.now();
        K.pushTimeline({
          type: 'story', title: '本章完',
          text: '「' + ((b && b.title) || '主线') + '」' + (c.title || '这一章') + ' 读完了。'
        });
        K.save(true);
        return null;
      }
      c.nodeIndex = U.int(c.nodeIndex, 0) + 1;
      c.updatedAt = Date.now();
      if (b) b.updatedAt = Date.now();
      K.save();
      return Chapter.node(c);
    },

    /** 本章读完了吗（读完才能续写下一章） */
    isFinished: function (chapterLike) {
      var c = Chapter.resolve(chapterLike);
      return !!c && c.status === 'finished';
    }
  };

  var Arc = {

    byId: function (id) { return Chapter.byId(id); },
    active: function (book) { return Chapter.active(book); },   // 不带参就取当前作品的当前章节

    setActive: function (id) {
      var st = K.state;
      if (!st) return false;
      var c = Chapter.byId(id);
      if (!c) return false;
      var b = Book.byId(id);
      if (b) st.story.activeBookId = b.id;
      st.story.activeChapterId = c.id;
      K.save();
      return true;
    },

    /**
     * 兼容入口：建「一部只有一章的作品」并返回那一章。
     * 旧的扁平「篇章」语义 = 新模型里的一章，所以老调用点不用改。
     */
    create: function (cfg) {
      var c = cfg || {};
      var book = Book.create({
        title: c.title || '未命名作品',
        synopsis: c.synopsis || '',
        theme: c.theme || '',
        styleId: (c.styleId === undefined ? null : c.styleId)
      });
      if (!book) return null;
      var ch = Chapter.create(book, {
        title: c.title || '第 1 章',
        synopsis: c.synopsis || '',
        nodes: c.nodes || [],
        theme: c.theme || ''
      });
      return ch;
    },

    remove: function (id) {
      var b = Book.byId(id);
      if (!b) return false;
      return Book.remove(b.id);
    },

    node: function (chapter, book) { return Chapter.node(chapter, book); },
    advance: function (chapter, book) { return Chapter.advance(chapter, book); },

    /** 记录一次选择（分支树 / 回溯用）；同时记下作品与章节 */
    recordChoice: function (chapterLike, node, choice) {
      var st = K.state;
      var c = Chapter.resolve(chapterLike);
      if (!st || !c) return null;
      var b = Book.byId(c.bookId) || Book.resolve(chapterLike);
      var row = {
        id: U.uid('br'),
        arcId: c.id,                       // 兼容旧字段（旧档的分支记录只有 arcId）
        chapterId: c.id,
        bookId: b ? b.id : null,
        arcTitle: (b && b.title) || '',
        bookTitle: (b && b.title) || '',
        chapterTitle: c.title || '',
        nodeId: node ? node.id : null,
        nodeTitle: node ? (node.title || '') : '',
        choiceId: choice ? choice.id : null,
        choiceText: choice ? choice.text : '',
        verdictDelta: choice ? U.int(choice.verdictDelta, 0) : 0,
        affinityDelta: choice ? U.int(choice.affinityDelta, 0) : 0,
        at: Date.now(),
        index: U.int(c.nodeIndex, 0)
      };
      st.story.branches.push(row);
      if (st.story.branches.length > 300) st.story.branches = st.story.branches.slice(-300);
      K.save();
      K.emit('branch', row);
      return row;
    },

    /** 存档点：完整快照当前章节 + 关键数值 */
    save: function (chapterLike, label) {
      var c = Chapter.resolve(chapterLike);
      var st = K.state;
      if (!c || !st) return null;
      var b = Book.byId(c.bookId);
      var snap = {
        id: U.uid('save'),
        label: label || ('存档 · ' + ((c.nodes[U.int(c.nodeIndex, 0)] || {}).title || ('进度 ' + c.nodeIndex))),
        at: Date.now(),
        nodeIndex: U.int(c.nodeIndex, 0),
        arcTitle: c.title,
        chapterTitle: c.title,
        bookTitle: b ? b.title : '',
        tierKey: st.tierKey,
        affinity: st.affinity,
        verdict: U.plain(st.verdict),
        wallet: U.plain(st.wallet),
        nodes: U.plain(c.nodes) || [],
        status: c.status
      };
      c.saves = c.saves || [];
      c.saves.unshift(snap);
      if (c.saves.length > 12) c.saves.length = 12;
      K.pushTimeline({
        type: 'save', title: '存档点',
        text: '在「' + ((b && b.title) || '主线') + ' · ' + (c.title || '') + '」的第 ' + (snap.nodeIndex + 1) + ' 个节点留下存档。'
      });
      K.save(true);
      return snap;
    },

    /** 读档：回到存档点 */
    load: function (chapterLike, saveId) {
      var c = Chapter.resolve(chapterLike);
      var st = K.state;
      if (!c || !st) return false;
      var snap = (c.saves || []).filter(function (x) { return x.id === saveId; })[0];
      if (!snap) return false;
      c.nodes = snap.nodes || c.nodes;
      c.nodeIndex = U.int(snap.nodeIndex, 0);
      c.status = snap.status || 'playing';
      st.tierKey = snap.tierKey || st.tierKey;
      st.affinity = U.int(snap.affinity, st.affinity);
      if (snap.verdict) st.verdict = snap.verdict;
      if (snap.wallet) st.wallet = snap.wallet;
      K.pushTimeline({ type: 'load', title: '读档', text: '回到存档点：' + snap.label });
      K.save(true);
      return true;
    },

    /** 回溯：把某个历史选择重新展开（分支树回溯） */
    rewindTo: function (branchId) {
      var st = K.state;
      if (!st) return false;
      var row = (st.story.branches || []).filter(function (b) { return b.id === branchId; })[0];
      if (!row) return false;
      var c = Chapter.byId(row.chapterId || row.arcId);
      if (!c) return false;
      c.nodeIndex = U.clamp(U.int(row.index, 0), 0, Math.max(0, (c.nodes || []).length - 1));
      c.status = 'playing';
      var b2 = Book.byId(c.bookId);
      if (b2) st.story.activeBookId = b2.id;
      st.story.activeChapterId = c.id;
      // 分支树中该点之后的记录作废（保留一次提示）
      K.pushTimeline({
        type: 'rewind', title: '分支回溯',
        text: '回到「' + ((b2 && b2.title) || '') + ' · ' + (c.title || '') + '」的选择点：' + U.cut(row.choiceText, 30)
      });
      K.save(true);
      return true;
    }
  };

  // ==========================================================================
  //  2. 生成器：AI 出题（攻略模式）/ AI 推演（自由行动）/ AI 裁决（反向模式）
  // ==========================================================================

  var Gen = {

    /** 系统提示：把角色设定、当前阶段、模式讲清楚 */
    baseSystem: async function (extra) {
      var profile = await K.charProfile();
      var user = await K.userProfile();
      var st = K.state;
      var tier = K.tier();
      var reverse = K.isReverse();
      var mood = K.moodOf(st.quiet.mood);
      var lines = [];
      lines.push('你在为一款女性向恋爱手游撰写互动剧情。');
      lines.push('玩家（User）：' + user.name + (user.persona ? ' —— ' + U.cut(user.persona, 240) : ''));
      lines.push('角色（Char）：' + profile.name + ' —— ' + U.cut(profile.persona || '（未填写，按名字气质发挥）', 420));
      lines.push('当前关系阶段：' + tier.name + '（第 ' + (K.tierIndex() + 1) + '/6 阶）');
      if (reverse) {
        lines.push('世界线：被攻略模式。屏幕前的 User 是「游戏角色 / 看板角色」，Char 才是狂热玩家，Char 深爱着 User，'
          + '一切行为都以博取 User 的好感为目的。当前 User 对 Char 的好感裁定值：'
          + U.int(st.verdict.value, 0) + '/100，Char 的心情：' + mood.name + '。');
      } else {
        lines.push('世界线：攻略模式。屏幕前的 User 是玩家，Char 是攻略目标。');
      }
      if (extra) lines.push(extra);
      lines.push('要求：中文，乙游质感，克制而有余味，不写任何 emoji，不用括号旁白腔。');
      return lines.join('\n');
    },

    /**
     * 续写提示词里的「前情提要」（纯函数，可单测）
     * 用户要求：续写下一章要**带上前面章节的梗概**，保证连贯。
     * 只喂「章名 + 梗概」而不是全文 —— 全文会把上下文挤爆，反而更容易写崩。
     * @param {object} book
     * @param {number} nextIndex 下一章的序号（从 0 开始）
     */
    chapterPlan: function (book, nextIndex) {
      var b = Book.resolve(book);
      var list = (b && b.chapters) || [];
      var n = U.int(nextIndex, list.length);
      var head = '这是这部作品的第 ' + (n + 1) + ' 章。';
      if (!list.length) return head + '（第一章，请把世界观与两人的关系起点立起来。）';
      var lines = list.map(function (c, i) {
        return '第 ' + (i + 1) + ' 章《' + (c.title || '') + '》：' + U.cut(c.synopsis || '（无梗概）', 90);
      });
      return head + '\n前情提要（只给梗概，正文不要重复）：\n' + lines.join('\n');
    },

    /** 生成失败时把**真实原因**摆给用户看（v1.5.47 的诊断路径，必须保留） */
    failModal: function (rawArc) {
      var why = K._lastAskError || '未知原因';
      K.logGen('arc', false, rawArc, 'no-raw:' + why);
      HG.H.modal({
        title: '没能调用到模型', icon: 'info', accent: '#c2607c', soft: '#FFEFF3',
        message: '这次没有拿到模型的返回，原因：\n\n' + why
          + '\n\n（这一步不会设 max_tokens、也不会截断模型输出。'
          + '如果是 401/403，去「设置 → API 连接协议 → 专用」检查心动游戏这一项；'
          + '如果是 400，多半是模型名或参数不被中转站接受。）'
      });
    },

    /**
     * ★ 生成一章（新建作品的第一章 / 继续写下一章，都走这里）
     *
     * @param {object} cfg {
     *   book      —— 作品（续写时传；新建时传 null/undefined）
     *   theme     —— 题材（新建时的主题句，或续写时用户补的一句走向）
     *   styleId   —— 文风
     *   chapterNo —— 续写的是第几章（从 0 开始；不传则取该书当前章节数）
     *   bookTitle  —— 新建作品时希望的书名（模型也允许自己起）
     *   isNew     —— true 表示这是新作品的第一章
     * }
     * @returns {Promise<{title, synopsis, nodes, raw}|null>}
     */
    generateChapter: async function (cfg) {
      // 生成一整章很贵，双击会生成两章（v1.5.41）
      if (HG.H.blocked('story-genarc', 2500)) { HG.H.toast('正在写，稍等一下'); return null; }
      var c = cfg || {};
      var book = c.book ? Book.resolve(c.book) : null;
      var theme = c.theme || (book && book.theme) || '一场没有预告的重逢';
      var styleId = (c.styleId === undefined ? (book ? book.styleId : null) : c.styleId);
      var styleBlock = K.styleBlock(styleId || null);
      var nextIndex = (c.chapterNo === undefined)
        ? ((book && (book.chapters || []).length) || 0)
        : U.int(c.chapterNo, 0);
      var isNew = !!c.isNew || !book;
      var plan = Gen.chapterPlan(book, nextIndex);
      var profile = await K.charProfile();

      var opening = isNew
        ? ('请为下面的主题**开一部新作品**，并直接写出它的第 1 章，共 8 个节点。\n'
          + '作品主题：' + theme + '\n'
          + (c.bookTitle ? '作品名（沿用这个，不要改）：' + c.bookTitle + '\n' : ''))
        : ('请接着这部作品**继续写下一章**，共 8 个节点。\n' + plan + '\n');

      var prompt = await Gen.baseSystem(
        opening + '\n'
        + (styleBlock ? styleBlock + '\n\n' : '')
        + K.arcFormatSpec()
        + '\n规则：\n'
        + '· 正好 8 个节点，且**每个节点的正文都要写满**，不要用一句话敷衍。\n'
        + '· 前 2 个节点铺陈氛围（可含 narration / dialogue）。\n'
        + '· 中间节点必须给出 2~3 个 options（"options" 至少 2 个），且不同选项的 affinityDelta 要有差异（可为负），'
        + '三个选项要导向真正不同的走向。\n'
        + '· 最后一个节点收束这一章的情绪，options 可以为空数组。\n'
        + '· sms / call / moment 三种节点是「剧情中途小手机」内容：\n'
        + '  sms = 一条短讯（text 写成短讯内容，speaker 写 char）；\n'
        + '  call = 一通电话（text 写来电时说的话）；\n'
        + '  moment = 一条朋友圈（text 写发的内容）。\n'
        + '· 这一章至少包含 1 个 sms 或 call 节点。\n'
        + (isNew ? '' : '· 不要重复前情提要里已经发生过的场景，要往前推进；这一章要有自己的小高潮。\n')
        + '· 文风要求（若上面给了）必须体现在每一个节点的用词与节奏里，不能只在开头体现。'
      );

      var rawArc = await K.ask(prompt, { temperature: 0.95 });
      if (rawArc === null) Gen.failModal(rawArc);
      var obj = K.parseArc(rawArc);
      // 节点太少（多半是输出被截断）：用更短的要求再试一次
      if (obj && Array.isArray(obj.nodes) && obj.nodes.length > 0 && obj.nodes.length < 4) {
        K.logGen('arc', true, rawArc, 'too-few-nodes:' + obj.nodes.length);
        HG.H.toast('这次只写出来 ' + obj.nodes.length + ' 段，正在补一次…');
        var retryPrompt = prompt.replace('共 8 个节点', '共 4 个节点')
          .replace('· 正好 8 个节点，且**每个节点的正文都要写满**，不要用一句话敷衍。',
            '· 正好 4 个节点，每个节点的正文 120 字以上。');
        var raw2 = await K.ask(retryPrompt, { temperature: 0.95 });
        var obj2 = K.parseArc(raw2);
        if (obj2 && Array.isArray(obj2.nodes) && obj2.nodes.length > obj.nodes.length) {
          obj = obj2; rawArc = raw2;
        }
      }
      if (!obj || !Array.isArray(obj.nodes) || !obj.nodes.length) {
        K.logGen('arc', false, rawArc, 'parse-failed');
        var head = String(rawArc || '').slice(0, 700);
        HG.H.modal({
          title: '这次没能解析成章节',
          icon: 'info', accent: '#c2607c', soft: '#FFEFF3',
          message: '模型是**有返回**的（共 ' + String(rawArc || '').length + ' 字），但我没解析出章节结构。\n'
            + '当前输出方案：' + (K.outputMode() === 'tag' ? '文字标签' : 'JSON 数组')
            + '（可在「后台管理 → 生成输出方案」切换后重试）\n\n'
            + '—— 模型返回的开头 ——\n' + head
        });
        obj = Gen.offlineChapter(theme, profile.name);
      } else {
        K.logGen('arc', true, rawArc, 'ok:' + obj.nodes.length);
      }
      return {
        title: obj.title || (theme + ' · 第 ' + (nextIndex + 1) + ' 章'),
        synopsis: obj.synopsis || '',
        nodes: Gen.normalizeNodes(obj.nodes),
        raw: rawArc
      };
    },

    /**
     * 兼容入口（旧签名）：生成「一部只有一章的作品」，返回那一章。
     * 老调用点（含历史测试）继续可用；新代码请直接用 Book.create + Gen.generateChapter。
     */
    generateArc: async function (theme, styleId) {
      var t = theme || '一场没有预告的重逢';
      var out = await Gen.generateChapter({ theme: t, styleId: styleId, isNew: true, chapterNo: 0 });
      if (!out) return null;
      var book = Book.create({
        title: out.title || t,
        synopsis: out.synopsis || '',
        theme: t,
        styleId: (styleId === undefined ? null : styleId)
      });
      if (!book) return null;
      return Chapter.create(book, {
        title: out.title || t,
        synopsis: out.synopsis || '',
        nodes: out.nodes,
        theme: t
      });
    },

    /** 规范化节点结构（AI 输出经常缺字段） */
    normalizeNodes: function (nodes) {
      return (nodes || []).map(function (n, i) {
        var options = (n.options || []).map(function (o, j) {
          return {
            id: o.id || ('opt' + i + '_' + j),
            text: String(o.text || ('选项 ' + (j + 1))),
            affinityDelta: U.int(o.affinityDelta, 0),
            verdictDelta: U.int(o.verdictDelta, 0),
            result: String(o.result || ''),
            consequence: o.consequence || null
          };
        });
        return {
          id: n.id || U.uid('node'),
          kind: ['narration', 'dialogue', 'sms', 'call', 'moment'].indexOf(n.kind) >= 0 ? n.kind : 'dialogue',
          title: String(n.title || ('第 ' + (i + 1) + ' 幕')),
          scene: String(n.scene || ''),
          bg: String(n.bg || ''),
          speaker: n.speaker === 'user' ? 'user' : (n.speaker === 'narration' ? 'narration' : 'char'),
          text: String(n.text || ''),
          emotion: n.emotion || 'calm',
          options: options,
          resolved: null
        };
      });
    },

    /** 离线兜底篇章 */
    offlineArc: function (theme, charName) {
      var nodes = [
        {
          kind: 'narration', title: '雨落下来', speaker: 'narration', bg: '雨天',
          scene: '傍晚的街口，雨来得比预报更早。',
          text: '雨点砸在便利店门口的塑料棚上，声音密得像有人在耳边小声说话。你没带伞，站在屋檐下数着路灯。',
          options: []
        },
        {
          kind: 'dialogue', title: '伞沿', speaker: 'char', bg: '雨天', emotion: 'calm',
          scene: '一把黑伞从侧面撑过来，伞骨微微偏向你这一侧。',
          text: '「你怎么在这儿。」' + charName + '的语气听不出情绪，伞却整个往你那边倾了过去，自己半边肩膀露在雨里。',
          options: [
            { text: '把伞推回去，让他也遮到', affinityDelta: 6, verdictDelta: 2, result: charName + '愣了一下，没接话，只是把伞柄往你手里塞了塞，自己往你身侧又靠近了半步。' },
            { text: '什么都不说，站得离他近一点', affinityDelta: 4, verdictDelta: 1, result: '他察觉到了，肩膀几不可察地放松下来。雨声很大，两个人谁都没开口。' },
            { text: '赌气说不用你管', affinityDelta: -3, verdictDelta: -1, result: '他把伞收回去了半寸，又停住，最后只是低声说：「……随你。」但那把伞始终没有真正收起来。' }
          ]
        },
        {
          kind: 'sms', title: '迟到的短讯', speaker: 'char', bg: '卧室', emotion: 'shy',
          scene: '深夜，你回到家，手机在口袋里震了一下。',
          text: '「到家了没。」\n隔了十几秒，又一条：「伞放你那儿了，明天记得还我。」',
          options: []
        },
        {
          kind: 'dialogue', title: '还不还', speaker: 'char', bg: '校园', emotion: 'blush',
          scene: '第二天的走廊尽头，他靠在窗边等你。',
          text: '「伞呢。」他伸手，掌心朝上。他明明可以直接拿走，却非要你先递过去——像是想借着这个动作，多确认一次什么。',
          options: [
            { text: '把伞递过去，指尖故意碰一下', affinityDelta: 7, verdictDelta: 2, result: '他手指缩了一下，那把伞差点掉在地上。他低头去捡，耳根红得很明显。' },
            { text: '说伞丢了，看他什么反应', affinityDelta: 2, verdictDelta: 0, result: '他盯了你三秒，然后说：「那我再去买一把，明天还给你。」——他没打算让这件事结束。' }
          ]
        },
        {
          kind: 'call', title: '凌晨的来电', speaker: 'char', bg: '卧室', emotion: 'surprise',
          scene: '凌晨一点多，屏幕亮起来，是他的名字。',
          text: '「……吵醒你了？」他的声音比平时低，「没什么事，就是突然想确认一下，你还在。」',
          options: [
            { text: '说我在，一直都在', affinityDelta: 9, verdictDelta: 3, result: '电话那头安静了很久，久到你以为他挂了。然后他轻轻「嗯」了一声，那声音有点发颤。' },
            { text: '问他是不是睡不着', affinityDelta: 5, verdictDelta: 1, result: '「嗯。」他承认得很干脆，「想你想得睡不着。」说完自己先笑了，笑声里没什么底气。' }
          ]
        },
        {
          kind: 'dialogue', title: '说出那句话', speaker: 'char', bg: '黄昏', emotion: 'calm',
          scene: '天台上，风把云吹得很开，夕阳落在两个人的肩上。',
          text: '他站在你面前，手里还攥着那把伞，像是攥了很久。他说：「我想过很多次要怎么开口——后来发现，都不用。」',
          options: [
            { text: '安静地听他说完', affinityDelta: 12, verdictDelta: 4, result: '「我喜欢你。」他说得很慢，一个字一个字，像是怕你没听清，又怕自己反悔。' },
            { text: '先一步把话说完', affinityDelta: 12, verdictDelta: 5, result: '你开口的瞬间他愣住了，然后笑了出来，肩膀终于松下来：「……被你抢先了。」' }
          ]
        }
      ];
      return { title: theme + ' · 初见篇', synopsis: '一场没有预告的雨，和一把一直偏向你的伞。', nodes: nodes };
    },

    /** 离线兜底的「一章」（generateChapter 的回落形态，与 offlineArc 同一份内容） */
    offlineChapter: function (theme, charName) {
      return Gen.offlineArc(theme, charName);
    },

    /**
     * 自由行动推演（攻略模式的底层自定义输入框）
     * @param {object} node
     * @param {string} action 用户键入的自由动作
     * @returns {Promise<{text:string, affinityDelta:number, verdictDelta:number}>}
     */
    freeAction: async function (node, action) {
      var prompt = await Gen.baseSystem(
        '现在玩家没有从给定选项里选，而是自己写了一个动作：\n「' + action + '」\n\n'
        + '当前场景：' + (node ? (node.scene || '') : '') + '\n'
        + '当前节点正文：' + (node ? U.cut(node.text, 200) : '') + '\n\n'
        + '请推演这个动作之后发生了什么。严格只返回 JSON：\n'
        + '{"text":"Char 的反应与场面变化，70~140 字，要有具体的身体反应或一句话直接引语",'
        + '"affinityDelta": 一个 -8 到 +12 之间的整数,'
        + '"verdictDelta": 一个 -4 到 +5 之间的整数,'
        + '"emotion":"calm|blush|surprise|away|shy"}'
      );
      var obj = await K.askJSON(prompt, null, { temperature: 0.95 });
      if (!obj || !obj.text) {
        return {
          text: '你做了这个动作。' + '空气安静了一瞬——他没有立刻回应，只是把视线落在你身上，久到你自己都开始不确定。',
          affinityDelta: 3, verdictDelta: 1, emotion: 'calm'
        };
      }
      return {
        text: String(obj.text),
        affinityDelta: U.clamp(U.int(obj.affinityDelta, 3), -8, 12),
        verdictDelta: U.clamp(U.int(obj.verdictDelta, 1), -4, 5),
        emotion: obj.emotion || 'calm'
      };
    },

    /**
     * 反向模式：User 设定抉择与奖惩，Char 基于性格模型自主选择
     * @returns {Promise<{choiceIndex:number, reason:string, text:string}>}
     */
    charDecide: async function (node) {
      var profile = await K.charProfile();
      var st = K.state;
      var opts = (node && node.options) || [];
      var listText = opts.map(function (o, i) {
        return (i + 1) + '. ' + o.text
          + '（好感 ' + (o.affinityDelta >= 0 ? '+' : '') + o.affinityDelta
          + ' / 裁定 ' + (o.verdictDelta >= 0 ? '+' : '') + o.verdictDelta + '）';
      }).join('\n');
      var prompt = await Gen.baseSystem(
        '现在轮到你（' + profile.name + '）做选择。你是玩家，你深爱着屏幕里的『' + (await K.userProfile()).name + '』。\n'
        + '当前 User 对你的好感裁定值：' + U.int(st.verdict.value, 0) + '/100。\n'
        + '当前心情：' + K.moodOf(st.verdict.mood).name + '。\n\n'
        + '局面：' + (node ? U.cut(node.text, 220) : '') + '\n\n'
        + '你面前有这些选项：\n' + listText + '\n\n'
        + '请严格依据你的性格模型与当前心境做出真实选择——不要总选最讨好的那个。'
        + '好感越高你越敢任性，好感越低你越小心翼翼。\n'
        + '严格只返回 JSON：\n'
        + '{"choiceIndex": 1, "reason":"你为什么会这么选，20~40 字，第一人称内心独白",'
        + '"emotion":"calm|blush|surprise|away|shy"}'
      );
      var obj = await K.askJSON(prompt, null, { temperature: 0.9 });
      var idx = obj ? U.clamp(U.int(obj.choiceIndex, 1) - 1, 0, Math.max(0, opts.length - 1)) : Math.floor(Math.random() * Math.max(1, opts.length));
      return {
        choiceIndex: idx,
        reason: (obj && obj.reason) || '……我想这么选。',
        emotion: (obj && obj.emotion) || 'calm'
      };
    },

    /** 把一段剧情摘要写进主记忆（让主聊天能召回） */
    persistMemory: async function (bookLike, node) {
      var sessId = await K.resolveSessionId();
      var book = Book.resolve(bookLike);
      var ch = Chapter.resolve(bookLike, book);
      if (!sessId || !book) return false;
      var content = '【心动游戏·' + book.title + '】'
        + (ch ? '（' + (ch.title || '') + '）' : '')
        + (node ? '（' + (node.title || '') + '）' : '')
        + (K.isReverse() ? '［被攻略模式］' : '［攻略模式］')
        + '：' + U.cut(node ? (node.text || node.scene || '') : (ch ? (ch.synopsis || '') : (book.synopsis || '')), 180);
      return K.writeMainMemory(sessId, content, ['心动游戏', '主线', book.title]);
    }
  };

  // ==========================================================================
  //  3. 剧情中途小手机（SMS / 假朋友圈 / 电话接入）
  // ==========================================================================

  var SubPhone = {

    /**
     * 解析一条记录该挂在谁名下。
     * 兼容两种调用：SubPhone.capture(node, chapter [, book]) 与老的 (node, arc)。
     */
    scope: function (x, y) {
      var ch = Chapter.resolve(x);
      var book = null;
      if (looksLikeBook(y)) book = y;
      else if (ch) book = Book.byId(ch.bookId) || Book.resolve(x);
      else book = Book.resolve(x);
      if (!ch && looksLikeBook(x)) ch = Chapter.active(x);
      if (ch && !book) book = Book.byId(ch.bookId);
      return { chapter: ch, book: book, bookId: book ? book.id : null, chapterId: ch ? ch.id : null };
    },

    /**
     * 把节点里的 sms / moment / call 落库
     * v1.5.46：按 arcId + nodeId 去重 —— 以前「从头回看」会把同一批消息再灌一遍，
     * 小手机里就出现两条一模一样的记录。现在同一个章节的同一个节点只记一次。
     * v1.5.49：去重键换成 **bookId + chapterId + nodeId**（一部作品一条线，按章分段）。
     */
    capture: function (node, chapterLike, bookLike) {
      var st = K.state;
      if (!st || !node) return null;
      var phone = st.story.phone;
      var at = Date.now();
      var sc = SubPhone.scope(chapterLike, bookLike);
      var bookId = sc.bookId, chapterId = sc.chapterId;
      var nodeId = node.id || null;
      var already = function (bucket) {
        for (var i = 0; i < bucket.length; i++) {
          var r = bucket[i];
          if (!r || !nodeId || r.nodeId !== nodeId) continue;
          // 旧记录只有 arcId：等价于 chapterId，所以两种都认
          if ((r.chapterId || r.arcId) === chapterId) return r;
        }
        return null;
      };
      if (node.kind === 'sms') {
        var dup = already(phone.sms);
        if (dup) return { kind: 'sms', row: dup, duplicate: true };
        var row = {
          id: U.uid('sms'), text: node.text || '', from: 'char', at: at,
          bookId: bookId, chapterId: chapterId, arcId: chapterId, nodeId: nodeId, read: false
        };
        phone.sms.unshift(row);
        if (phone.sms.length > 120) phone.sms.length = 120;
        K.save();
        return { kind: 'sms', row: row };
      }
      if (node.kind === 'moment') {
        var dupM = already(phone.moments);
        if (dupM) return { kind: 'moment', row: dupM, duplicate: true };
        var m = {
          id: U.uid('mom'), text: node.text || '', at: at,
          bookId: bookId, chapterId: chapterId, arcId: chapterId, nodeId: nodeId,
          likes: [], comments: []
        };
        phone.moments.unshift(m);
        if (phone.moments.length > 60) phone.moments.length = 60;
        K.save();
        return { kind: 'moment', row: m };
      }
      if (node.kind === 'call') {
        var dupC = already(phone.calls);
        if (dupC) return { kind: 'call', row: dupC, duplicate: true };
        var c = {
          id: U.uid('call'), text: node.text || '', at: at,
          bookId: bookId, chapterId: chapterId, arcId: chapterId, nodeId: nodeId, duration: 0
        };
        phone.calls.unshift(c);
        if (phone.calls.length > 60) phone.calls.length = 60;
        K.save();
        return { kind: 'call', row: c };
      }
      return null;
    },

    /** 清掉某个筛选条件命中的记录，返回清掉的条数 */
    _purge: function (match) {
      var st = K.state;
      if (!st) return 0;
      var phone = st.story.phone;
      var n = 0;
      ['sms', 'moments', 'calls'].forEach(function (k) {
        var before = (phone[k] || []).length;
        phone[k] = (phone[k] || []).filter(function (r) { return !(r && match(r)); });
        n += before - phone[k].length;
      });
      if (n) K.save();
      return n;
    },

    /** 一章被删掉时，把它在小手机里留下的记录一起清掉（用户要求：小手机依托主线剧情） */
    purgeChapter: function (bookId, chapterId) {
      if (!chapterId) return 0;
      return SubPhone._purge(function (r) {
        return (r.chapterId || r.arcId) === chapterId && (!bookId || !r.bookId || r.bookId === bookId);
      });
    },

    /** 整部作品被删掉时，把它的全部记录清掉 */
    purgeBook: function (bookId) {
      if (!bookId) return 0;
      var chapters = (Chapter.list(bookId) || []).map(function (c) { return c.id; });
      return SubPhone._purge(function (r) {
        return r.bookId === bookId || chapters.indexOf(r.chapterId || r.arcId) >= 0;
      });
    },

    /** 兼容旧的调用名（旧代码只知道 arcId） */
    purgeArc: function (arcId) { return SubPhone.purgeChapter(null, arcId); },

    /** 这部作品里的全部手机记录（按时间倒序），带章节归属，供 UI 分段 */
    rowsOf: function (bookLike) {
      var st = K.state;
      if (!st) return { sms: [], moments: [], calls: [] };
      var book = Book.resolve(bookLike);
      var bookId = book ? book.id : null;
      var chapterIds = book ? (book.chapters || []).map(function (c) { return c.id; }) : [];
      var pick = function (list) {
        return (list || []).filter(function (r) {
          if (!r) return false;
          if (r.bookId) return r.bookId === bookId;
          // 旧记录没有 bookId：用 arcId/chapterId 反查
          var cid = r.chapterId || r.arcId;
          return !!cid && chapterIds.indexOf(cid) >= 0;
        });
      };
      return {
        sms: pick(st.story.phone.sms),
        moments: pick(st.story.phone.moments),
        calls: pick(st.story.phone.calls)
      };
    },

    /**
     * 在剧情里给出「在手机里回一句」的界面（v1.5.39）
     * 用户：「当提示有小手机剧情时，需要 user 真的能用小手机回复，或者在小手机里选择回复，
     *        这样才沉浸感。」
     * 做法参考乙女游戏：不是弹一个普通对话框，而是把**手机本体**呈现在剧情里 ——
     * 上面是 TA 发来的那条消息，下面是回复候选 + 自己打一句。
     */
    buildReplyOptions: function (node, host, onPick) {
      var wrap = H.el('div');
      wrap.style.cssText = 'border-radius:18px; padding:11px 11px 12px; margin-bottom:4px;'
        + 'background:linear-gradient(165deg,#2c2130,#463247 62%,#2c2130);'
        + 'box-shadow:0 10px 26px rgba(40,24,38,0.42), inset 0 1px 0 rgba(255,255,255,0.10);';
      var notch = H.el('div');
      notch.style.cssText = 'width:44px;height:4px;border-radius:3px;background:rgba(255,255,255,0.22);margin:0 auto 8px;';
      wrap.appendChild(notch);

      var screen = H.el('div');
      screen.style.cssText = 'border-radius:13px; padding:10px 11px; background:rgba(255,255,255,0.95);';
      var from = node.kind === 'call' ? '正在通话' : (node.kind === 'moment' ? 'TA 的动态' : '刚刚');
      screen.innerHTML = '<div style="font-size:9.4px; color:#a99fae; margin-bottom:5px;">' + U.esc(from) + '</div>'
        + '<div style="font-size:12px; line-height:1.7; color:#4a4050; white-space:pre-wrap;">'
        + U.esc(node.text || '') + '</div>';
      wrap.appendChild(screen);

      var tip = H.el('div');
      tip.style.cssText = 'font-size:9.6px; color:rgba(255,255,255,0.72); margin:9px 2px 6px;';
      tip.textContent = node.kind === 'call' ? '接起来，说点什么：' : '回一句：';
      wrap.appendChild(tip);

      SubPhone.replyCandidates(node).forEach(function (text) {
        var b = H.el('button', { type: 'button' });
        b.style.cssText = 'display:block; width:100%; text-align:left; box-sizing:border-box;'
          + 'margin-bottom:6px; padding:9px 11px; border-radius:12px; font-size:11.6px; line-height:1.55;'
          + 'cursor:pointer; border:1px solid rgba(240,196,216,0.45); background:rgba(255,255,255,0.96); color:#4a4050;';
        b.textContent = text;
        b.onclick = function () { onPick(text); };
        wrap.appendChild(b);
      });

      var row = H.el('div');
      row.style.cssText = 'display:flex; gap:7px;';
      var input = H.el('input', { type: 'text', placeholder: '自己打一句回过去…' });
      input.style.cssText = 'flex:1; box-sizing:border-box; border-radius:12px; border:1px solid rgba(240,196,216,0.4);'
        + 'padding:9px 11px; font-size:11.8px; color:#3a3040; background:#fff; outline:none; font-family:inherit;';
      row.appendChild(input);
      var send = H.iconButton('send', { size: 36, color: '#fff', bg: 'linear-gradient(135deg,#D97FA8,#B79EDC)', border: 'none' });
      send.onclick = function () {
        var t = input.value.trim();
        if (!t) { H.toast('先打一句'); return; }
        onPick(t);
      };
      input.onkeydown = function (e) { if (e.key === 'Enter') send.onclick(); };
      row.appendChild(send);
      wrap.appendChild(row);

      host.appendChild(wrap);
      setTimeout(function () { try { input.focus(); } catch (e) { } }, 120);
    },

    /**
     * 回复候选（纯函数，可单测）
     * 优先用节点自带的 options；没有就给几条符合手机语境的通用候选。
     */
    replyCandidates: function (node) {
      var opts = (node && node.options) || [];
      var fromNode = opts.map(function (o) { return String((o && o.text) || '').trim(); }).filter(Boolean);
      if (fromNode.length) return fromNode.slice(0, 4);
      var kind = node && node.kind;
      if (kind === 'call') return ['接起来，先不出声', '「喂？」', '「你怎么突然打过来。」'];
      if (kind === 'moment') return ['点了个赞', '在下面回一句', '私聊 TA'];
      return ['「在。」', '「怎么了？」', '「我马上过去。」', '先不回，等 TA 再说'];
    },

    /** 把用户的回复也记进小手机的短讯流（这样之后翻手机能看到自己说过的话） */
    pushUserReply: function (text, node, arc) {
      var st = K.state;
      if (!st || !text) return null;
      var phone = st.story.phone;
      var bucket = (node && node.kind === 'call') ? phone.calls
        : (node && node.kind === 'moment') ? phone.moments : phone.sms;
      var row = {
        id: U.uid('me'), text: String(text), from: 'user', at: Date.now(),
        arcId: arc ? arc.id : null, read: true
      };
      bucket.unshift(row);
      if (bucket.length > 120) bucket.length = 120;
      K.save();
      return row;
    },

    /**
     * 小手机界面
     *
     * 用户明确指定：「整部作品一条线」—— 翻手机看到的是跟这个人**从头到现在的全部消息**，
     * 按章节分段。所以这里不再按当前篇章取记录，而是取整部作品的全部记录，
     * 每一段前面插一个「第 N 章 · 章名」的分隔条。
     *
     * @param {object} bookLike 作品（不传则取当前作品）
     */
    open: async function (bookLike) {
      var st = K.state;
      var book = Book.resolve(bookLike) || Book.active();
      var profile = await K.charProfile();
      var user = await K.userProfile();
      var mine = SubPhone.rowsOf(book);
      var chapterIndex = {};
      ((book && book.chapters) || []).forEach(function (c, i) { chapterIndex[c.id] = i; });
      var chapterTitle = {};
      ((book && book.chapters) || []).forEach(function (c) { chapterTitle[c.id] = c.title || ''; });

      var body = H.el('div');
      var tab = 'sms';

      // 手机外壳
      var phone = H.el('div');
      phone.style.cssText = 'position:relative; border-radius:26px; padding:12px 10px 14px;'
        + 'background:linear-gradient(165deg,#2c2130,#4a3344 60%,#2c2130);'
        + 'box-shadow:0 18px 44px rgba(60,40,58,0.35), inset 0 1px 0 rgba(255,255,255,0.12);';
      var notch = H.el('div');
      notch.style.cssText = 'width:52px; height:4px; border-radius:3px; background:rgba(255,255,255,0.24);'
        + 'margin:0 auto 10px;';
      phone.appendChild(notch);
      var screen = H.el('div');
      screen.style.cssText = 'border-radius:18px; overflow:hidden; background:linear-gradient(170deg,#fffaff,#f6f2fb);'
        + 'min-height:400px; display:flex; flex-direction:column;';
      phone.appendChild(screen);
      body.appendChild(phone);

      var head = H.el('div');
      head.style.cssText = 'padding:11px 13px 9px; background:linear-gradient(180deg,rgba(255,241,247,0.95),rgba(255,255,255,0.6));'
        + 'border-bottom:1px solid rgba(216,160,190,0.18);';
      head.innerHTML = '<div style="font-size:12.5px; font-weight:800; color:#5c4450;">' + U.esc(profile.name) + ' 的手机</div>'
        + '<div style="font-size:9.6px; color:#a99fae; margin-top:2px;">'
        + U.esc(book ? (book.title + ' · 从头到现在') : '剧情进程中的即时通讯') + '</div>';
      screen.appendChild(head);

      var tabs = H.el('div');
      tabs.style.cssText = 'padding:9px 11px 4px;';
      screen.appendChild(tabs);

      var list = H.el('div');
      list.style.cssText = 'flex:1; overflow-y:auto; padding:8px 12px 14px;';
      screen.appendChild(list);

      function renderTabs() {
        tabs.innerHTML = '';
        tabs.appendChild(H.tabs([
          { key: 'sms', label: '短讯', icon: 'msg', badge: mine.sms.length || '' },
          { key: 'moment', label: '朋友圈', icon: 'camera', badge: mine.moments.length || '' },
          { key: 'call', label: '通话', icon: 'call', badge: mine.calls.length || '' }
        ], tab, function (k) { tab = k; renderTabs(); renderList(); }));
      }

      /** 一段记录属于第几章：插一条章节分隔条 */
      function chapterDivider(row) {
        var cid = row.chapterId || row.arcId;
        if (cid === undefined || cid === null || !(cid in chapterIndex)) return null;
        var i = chapterIndex[cid];
        var bar = H.el('div');
        bar.style.cssText = 'display:flex; align-items:center; gap:8px; margin:14px 2px 10px;';
        bar.innerHTML = '<span style="flex:1; height:1px; background:linear-gradient(90deg, rgba(216,160,190,0),'
          + ' rgba(216,160,190,0.46));"></span>'
          + '<span style="font-size:9.6px; font-weight:800; letter-spacing:.1em; color:#b08aa0; white-space:nowrap;">'
          + '第 ' + (i + 1) + ' 章 · ' + U.esc(U.cut(chapterTitle[cid] || '', 12)) + '</span>'
          + '<span style="flex:1; height:1px; background:linear-gradient(90deg, rgba(216,160,190,0.46),'
          + ' rgba(216,160,190,0));"></span>';
        return bar;
      }

      function renderList() {
        list.innerHTML = '';
        var rows = mine[tab === 'sms' ? 'sms' : (tab === 'moment' ? 'moments' : 'calls')] || [];
        if (!rows.length) {
          list.appendChild(H.empty(tab === 'sms' ? '这部作品还没有剧情短讯。' : (tab === 'moment' ? '这部作品还没有剧情朋友圈。' : '这部作品还没有剧情来电。'),
            { icon: tab === 'call' ? 'call' : 'phone' }));
          return;
        }
        var lastChapter = null;
        rows.forEach(function (r) {
          var cid = r.chapterId || r.arcId;
          if (cid !== lastChapter) {
            lastChapter = cid;
            var bar = chapterDivider(r);
            if (bar) list.appendChild(bar);
          }
          if (tab === 'sms') {
            list.appendChild(H.bubble({
              side: 'char',
              text: r.text,
              name: profile.name,
              meta: U.timeAgo(r.at),
              avatarNode: H.avatar(profile.avatar, profile.name, 30)
            }));
          } else if (tab === 'moment') {
            var card = H.card({ accent: '#7E97C9', soft: '#EDF2FB', pad: 12 });
            card.style.marginBottom = '10px';
            var headRow = H.el('div');
            headRow.style.cssText = 'display:flex; align-items:center; gap:9px; margin:4px 0 9px;';
            headRow.appendChild(H.avatar(profile.avatar, profile.name, 34));
            var who = H.el('div');
            who.innerHTML = '<div style="font-size:11.6px; font-weight:800; color:#5c4450;">' + U.esc(profile.name) + '</div>'
              + '<div style="font-size:9.4px; color:#a99fae;">' + U.timeAgo(r.at) + '</div>';
            headRow.appendChild(who);
            card.appendChild(headRow);
            var txt = H.el('div', {}, U.esc(r.text));
            txt.style.cssText = 'font-size:12px; line-height:1.78; color:#5c4450; white-space:pre-wrap;';
            card.appendChild(txt);
            // 假点赞 / 假评论
            var acts = H.el('div');
            acts.style.cssText = 'display:flex; gap:9px; margin-top:10px; align-items:center;';
            var likeB = H.button('点赞 ' + ((r.likes || []).length || ''), {
              kind: 'soft', pad: '5px 10px', size: 10.4, icon: 'heart', soft: '#FFEBF3', color: '#B0728F'
            });
            likeB.onclick = function () {
              r.likes = r.likes || [];
              var mine = r.likes.indexOf('me');
              if (mine >= 0) r.likes.splice(mine, 1); else r.likes.push('me');
              K.save();
              renderList();
            };
            acts.appendChild(likeB);
            var cmtB = H.button('让 TA 评论', {
              kind: 'soft', pad: '5px 10px', size: 10.4, icon: 'msg', soft: '#EDF2FB', color: '#5f7aa8'
            });
            cmtB.onclick = async function () {
              var prompt = await Gen.baseSystem(
                '你在扮演 ' + profile.name + '。你刚发了一条朋友圈：\n「' + r.text + '」\n\n'
                + '玩家 ' + user.name + ' 点了赞。请写一条你自己在评论区追加的回复，'
                + '20~40 字，第一人称，符合当前关系阶段与心情，不要写旁白。'
              );
              var out = await K.ask(prompt, { temperature: 0.95 });
              if (!out) { H.toast('模型不可用'); return; }
              r.comments = r.comments || [];
              r.comments.push({ by: profile.name, text: out.replace(/\n+/g, ' ').trim(), at: Date.now() });
              K.save();
              renderList();
            };
            acts.appendChild(cmtB);
            card.appendChild(acts);
            (r.comments || []).forEach(function (c) {
              var cm = H.el('div');
              cm.style.cssText = 'margin-top:9px; padding:8px 10px; border-radius:11px; background:rgba(237,242,251,0.8);'
                + 'font-size:11px; line-height:1.7; color:#5f6b82;';
              cm.innerHTML = '<b style="color:#4A7DBF;">' + U.esc(c.by) + '</b>：' + U.esc(c.text);
              card.appendChild(cm);
            });
            list.appendChild(card);
          } else {
            var call = H.listRow({
              icon: 'call', color: '#D97FA8', soft: '#FFEBF3',
              title: '来电 · ' + U.timeAgo(r.at),
              subtitle: r.text,
              subtitleWrap: true
            });
            call.onclick = function () { SubPhone.playCall(r, profile); };
            list.appendChild(call);
          }
        });
      }

      renderTabs();
      renderList();

      H.sheet({
        title: '剧情小手机',
        subtitle: book ? (book.title + ' · 整条线') : '当前作品',
        icon: 'phone',
        height: '92%',
        // v1.5.46：要盖在主线演出（100600）之上，否则会被压在下面看不见（用户反馈重叠）
        z: 100700,
        slot: 'subphone',
        content: body
      });
    },

    /** 电话接入演出 */
    playCall: function (call, profile) {
      var body = H.el('div');
      var ring = H.el('div');
      ring.style.cssText = 'text-align:center; padding:20px 0 10px;';
      ring.innerHTML = '<div style="width:84px; height:84px; margin:0 auto 14px; border-radius:50%;'
        + 'background:linear-gradient(150deg,#FFEBF3,#F3EEFF); display:flex; align-items:center; justify-content:center;'
        + 'color:#D97FA8; box-shadow:0 0 0 8px rgba(217,127,168,0.12); animation:hg-pulse 1.6s ease-in-out infinite;">'
        + H.icon('call', 34, { strokeWidth: 1.7 }) + '</div>'
        + '<div style="font-size:14.5px; font-weight:800; color:#553f4c;">' + U.esc(profile.name) + '</div>'
        + '<div style="font-size:10.6px; color:#a99fae; margin-top:5px;">通话中 · ' + U.timeAgo(call.at) + '</div>';
      body.appendChild(ring);

      var voice = H.el('div');
      voice.style.cssText = 'margin-top:10px; padding:14px; border-radius:16px; font-size:12.6px; line-height:1.86;'
        + 'color:#5c4450; background:linear-gradient(150deg,rgba(255,255,255,0.96),rgba(255,246,250,0.9));'
        + 'border:1px solid rgba(216,160,190,0.24); white-space:pre-wrap;';
      voice.textContent = '「' + (call.text || '……') + '」';
      body.appendChild(voice);

      var tip = H.el('div');
      tip.style.cssText = 'font-size:10.4px; color:#a99fae; text-align:center; margin-top:14px;';
      tip.textContent = '你可以继续在剧情里回应这通电话。';
      body.appendChild(tip);

      H.confirm({
        title: '剧情来电',
        icon: 'call', accent: '#D97FA8', soft: '#FFEBF3',
        message: (profile.name + '：' + (call.text || '')).slice(0, 160),
        okText: '接起来', cancelText: '稍后'
      }).then(function (ok) {
        if (!ok) return;
        H.sheet({
          title: '通话中', subtitle: profile.name, icon: 'call',
          height: '60%', content: body,
          buttons: [{ text: '挂断', kind: 'outline', color: '#8f6a80' }]
        });
      });
    }
  };

  // ==========================================================================
  //  4. 演出层：VN 舞台
  // ==========================================================================

  var Stage = {
    _current: null,
    _bgLayer: null,
    _portraitHost: null,

    /** 开场：把舞台铺到容器里 */
    mount: function (host) {
      host.innerHTML = '';
      var stage = H.el('div', { class: 'hg-vn-stage hg-rise' });
      stage.style.cssText = 'position:absolute; inset:0; overflow:hidden;';

      var bg = H.el('div');
      bg.style.cssText = 'position:absolute; inset:0; background:linear-gradient(170deg,#2c2130 0%,#4a3344 46%,#1f1720 100%);'
        + 'transition:background-image .6s ease, opacity .6s ease;';
      stage.appendChild(bg);
      Stage._bgLayer = bg;

      // 氛围蒙版
      var veil = H.el('div');
      veil.style.cssText = 'position:absolute; inset:0; pointer-events:none;'
        + 'background:radial-gradient(circle at 50% 34%, rgba(255,255,255,0.13) 0%, rgba(0,0,0,0.42) 78%);';
      stage.appendChild(veil);

      // 立绘层
      // v1.5.45：和主页看板用**完全相同的几何**（主页是 top:6%; bottom:0），
      // 之前这里是 top:8%; bottom:118px，所以主线里的立绘整体偏上、也比主页小一截。
      var portraitHost = H.el('div');
      portraitHost.style.cssText = 'position:absolute; left:0; right:0; top:6%; bottom:0;';
      stage.appendChild(portraitHost);
      Stage._portraitHost = portraitHost;

      host.appendChild(stage);
      Stage._current = stage;
      return stage;
    },

    /** 设置背景（用户自定义图 > 内置场景插画 > 关键词渐变） */
    setBackground: async function (bgKey) {
      var layer = Stage._bgLayer;
      if (!layer) return;
      var custom = K.currentBackground();
      var picked = (K.state && K.state.assets) ? K.state.assets.currentBackgroundId : null;

      // ① 用户自己上传并选中的背景优先（内置素材不算「用户指定」，否则会把剧情场景顶掉）
      if (picked && custom && custom.src && !custom.builtin) {
        layer.style.backgroundImage = 'url(' + custom.src + ')';
        layer.style.backgroundSize = 'cover';
        layer.style.backgroundPosition = 'center';
        return;
      }

      // ② 内置场景插画：按节点 bg 关键词映射（以前这里完全没接入这三张图）
      var art = STAGE_SCENE_ART[bgKey];
      if (art) {
        layer.style.backgroundImage = 'url(' + art + ')';
        layer.style.backgroundSize = 'cover';
        layer.style.backgroundPosition = 'center';
        return;
      }

      // ③ 兜底：关键词渐变
      var GRADS = {
        '雨天': 'linear-gradient(170deg,#3a4553 0%,#55606e 50%,#2b333d 100%)',
        '卧室': 'linear-gradient(170deg,#3b2f3d 0%,#6b5566 50%,#2a2130 100%)',
        '校园': 'linear-gradient(170deg,#48586b 0%,#7d8fa3 52%,#2f3a47 100%)',
        '黄昏': 'linear-gradient(170deg,#6b4436 0%,#c98a63 46%,#3a2733 100%)',
        '街道': 'linear-gradient(170deg,#33323f 0%,#5c5a72 50%,#221f2b 100%)',
        '咖啡店': 'linear-gradient(170deg,#4a3a2f 0%,#8a6d55 50%,#2e241d 100%)',
        '海边': 'linear-gradient(170deg,#2f4a5c 0%,#6fa2b8 46%,#20313d 100%)',
        '露台': 'linear-gradient(170deg,#2c2a45 0%,#5d5786 50%,#1d1b2e 100%)',
        '车内': 'linear-gradient(170deg,#25232c 0%,#454257 52%,#17161d 100%)'
      };
      layer.style.backgroundImage = GRADS[bgKey] || GRADS['卧室'];
    },

    /** 立绘：切换表情 / 动作 */
    setEmotion: async function (emotion) {
      var host = Stage._portraitHost;
      if (!host) return;
      if (!host._renderer) {
        if (HG.Portraits) {
          // 主线里**不挂热区层**（用户要求「主线里不要触发触碰反应」）：
          // showOverlay:false 让渲染器根本不建可点区域，连点击反馈都不会有
          var res = await HG.Portraits.mount(host, { onTouch: null, showOverlay: false });
          host._renderer = res;
        }
      }
      var r = host._renderer;
      if (r && r.renderer && r.renderer.react) {
        r.renderer.react('face', emotion);
      }
    }
  };

  // ==========================================================================
  //  5. 主界面：篇章选择 / 剧情播放 / 分支树
  // ==========================================================================

  /**
   * 内置场景插画（v1.5.35）
   * 以前 VN 舞台只认「9 个关键词渐变」，这三张真正的场景图从来没被用上。
   * 现在按节点 bg 关键词映射过去：有图用图、没图回落渐变。
   */
  var STAGE_SCENE_ART = {
    '卧室': 'images/heartgame/stage/bg-night.png',
    '深夜': 'images/heartgame/stage/bg-night.png',
    '房间': 'images/heartgame/stage/bg-night.png',
    '咖啡店': 'images/heartgame/stage/bg-night.png',
    '雨天': 'images/heartgame/stage/bg-rain.png',
    '雨夜': 'images/heartgame/stage/bg-rain.png',
    '街道': 'images/heartgame/stage/bg-rain.png',
    '车内': 'images/heartgame/stage/bg-rain.png',
    '黄昏': 'images/heartgame/stage/bg-dusk.png',
    '露台': 'images/heartgame/stage/bg-dusk.png',
    '天台': 'images/heartgame/stage/bg-dusk.png',
    '校园': 'images/heartgame/stage/bg-dusk.png',
    '海边': 'images/heartgame/stage/bg-dusk.png'
  };

  /**
   * 退出主线后把主页立绘重新挂上（v1.5.35）
   * 主线与主页**共用同一个 Portraits 单例**：进主线时 Stage.mount() 已经销毁了主页的
   * renderer 与资源池，退出时如果没人复挂，回到看板就只剩一片空舞台。
   * 只在心动游戏窗口仍然打开时复挂 —— 否则就是「关应用时反而把界面重新画出来」。
   */
  function remountLobbyPortrait() {
    try {
      var win = document.getElementById('win-heartgame');
      if (!win || !win.classList.contains('active')) return;
      if (window.heartGameApp && typeof window.heartGameApp.render === 'function') {
        window.heartGameApp.render();
      }
    } catch (e) { }
  }

  var UI = {
    _arc: null,        // 兼容旧字段名：当前正在演出的章节
    _busy: false,

    // ------------------------------------------------------------------
    //  5.0 小工具
    // ------------------------------------------------------------------

    /** 长一点的提示：用模态，用户不会错过（用户要求"失败不再静默"） */
    tip: function (title, message) {
      H.modal({ title: title, icon: 'info', accent: '#c2607c', soft: '#FFEFF3', message: message });
    },

    /** 作品卡片上的封面：有生图就用图，没有就一块玻璃底 + 首字 */
    coverNode: function (book, w, h) {
      var box = H.el('div');
      box.style.cssText = 'position:relative; width:' + w + 'px; height:' + h + 'px; flex-shrink:0;'
        + 'border-radius:14px; overflow:hidden;'
        + 'background:linear-gradient(150deg,#4a3344,#2c2130 62%,#3b2b3c);'
        + 'box-shadow:0 8px 20px rgba(70,44,66,0.28), inset 0 1px 0 rgba(255,255,255,0.14);'
        + (book && book.cover ? 'background-image:url(' + book.cover + '); background-size:cover;'
          + ' background-position:center;' : '');
      if (!book || !book.cover) {
        var ch = H.el('div');
        ch.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;'
          + 'font-size:' + Math.round(h * 0.38) + 'px; font-weight:900; color:rgba(255,255,255,0.88);'
          + 'text-shadow:0 2px 10px rgba(0,0,0,0.4);';
        ch.textContent = (book && book.title ? book.title.slice(0, 1) : '书');
        box.appendChild(ch);
        var bar = H.el('div');
        bar.style.cssText = 'position:absolute; left:0; top:0; bottom:0; width:4px;'
          + 'background:linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.06));';
        box.appendChild(bar);
      }
      return box;
    },

    /** 进度条（自绘，避免依赖具体组件签名） */
    progressNode: function (pct, color) {
      var track = H.el('div');
      track.style.cssText = 'height:5px; border-radius:3px; background:rgba(190,180,195,0.28); overflow:hidden;';
      var fill = H.el('div');
      fill.style.cssText = 'height:100%; width:' + U.clamp(U.round(pct, 0), 0, 100) + '%; border-radius:3px;'
        + 'background:linear-gradient(90deg,' + (color || '#D97FA8') + ',#B79EDC);';
      track.appendChild(fill);
      return track;
    },

    /** 空书架的空态卡片（比 H.empty 更有引导性） */
    emptyShelf: function () {
      var card = H.card({ accent: '#D97FA8', soft: '#FFEBF3', pad: 16 });
      card.appendChild(H.sectionTitle('书架还是空的', { color: '#D97FA8', margin: '2px 0 8px' }));
      var p = H.el('div');
      p.style.cssText = 'font-size:11.4px; line-height:1.86; color:#8b8292;';
      p.textContent = '一部作品就是一条完整的关系线：给它一个名字，AI 写出第一章，'
        + '之后想接着看就「继续写下一章」。作品可以有很多部，小手机里翻到的是整部作品从头到现在的全部消息。';
      card.appendChild(p);
      return card;
    },

    // ------------------------------------------------------------------
    //  5.1 书架（多作品）
    // ------------------------------------------------------------------

    /**
     * 书架：一格格作品卡片。
     * 用户原话：「整部作品一条线，书架式构图，多个作品」。
     */
    openShelf: async function () {
      var body = H.el('div');
      var books = Book.all();

      var intro = H.el('div');
      intro.style.cssText = 'font-size:10.8px; line-height:1.74; color:#8b8292;'
        + 'background:rgba(255,255,255,0.76); border:1px solid rgba(217,127,168,0.22);'
        + 'border-radius:14px; padding:11px 12px; margin-bottom:12px;';
      intro.innerHTML = K.isReverse()
        ? '当前是<b>被攻略模式</b>：你给作品定方向，节点停顿时由你设定 2~3 个抉择并附带奖惩，'
          + '<b>TA 会依自己的性格做出选择</b>。'
        : '当前是<b>攻略模式</b>：一部作品一条线，按章节读下去；每一章都可以让 AI 接着上一章的梗概继续写。';
      body.appendChild(intro);

      if (!books.length) body.appendChild(UI.emptyShelf());

      books.forEach(function (b) {
        var chapters = b.chapters || [];
        var pct = Book.progress(b);
        var finished = Book.finishedCount(b);
        var card = H.card({ accent: '#D97FA8', soft: '#FFEBF3', pad: 12 });
        card.style.marginBottom = '10px';
        card.style.cursor = 'pointer';

        var row = H.el('div');
        row.style.cssText = 'display:flex; gap:12px; align-items:flex-start;';
        row.appendChild(UI.coverNode(b, 58, 78));

        var main = H.el('div');
        main.style.cssText = 'flex:1; min-width:0;';
        var title = H.el('div');
        title.style.cssText = 'font-size:13px; font-weight:800; color:#553f4c;'
          + 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
        title.textContent = b.title || '未命名作品';
        main.appendChild(title);

        var meta = H.el('div');
        meta.style.cssText = 'font-size:9.8px; color:#a99fae; margin-top:4px;';
        meta.textContent = chapters.length + ' 章 · 已读 ' + finished + ' 章 · ' + U.round(pct, 0) + '% · '
          + U.timeAgo(b.updatedAt || b.createdAt);
        main.appendChild(meta);

        var syn = H.el('div');
        syn.style.cssText = 'font-size:10.6px; line-height:1.7; color:#8b8292; margin-top:7px;';
        syn.textContent = U.cut(b.synopsis || b.theme || '（还没有梗概）', 48);
        main.appendChild(syn);

        var pb = H.el('div');
        pb.style.marginTop = '8px';
        pb.appendChild(UI.progressNode(pct, '#D97FA8'));
        main.appendChild(pb);
        row.appendChild(main);

        var tools = H.el('div');
        tools.style.cssText = 'display:flex; flex-direction:column; gap:6px; flex-shrink:0;';
        var del = H.iconButton('trash', { size: 26, color: '#c2607c', title: '删除作品' });
        del.onclick = function (ev) {
          ev.stopPropagation();
          H.confirm({
            title: '删除作品', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
            message: '删除「' + b.title + '」？这部作品的 ' + chapters.length
              + ' 个章节、存档点，以及它留在小手机里的全部消息都会一起消失。',
            okText: '删除'
          }).then(function (ok) {
            if (!ok) return;
            Book.remove(b.id);
            H.closeAllLayers();
            setTimeout(function () { UI.openShelf(); }, 320);
          });
        };
        tools.appendChild(del);
        row.appendChild(tools);

        card.appendChild(row);
        card.onclick = function () { UI.openBook(b.id); };
        body.appendChild(card);
      });

      H.sheet({
        title: '书架 · 我的作品',
        subtitle: '一部作品一条线 · 章节可以一直续写',
        icon: 'book',
        height: '100%',
        slot: 'story',
        // 全屏页 + 生图背景（v1.5.42 的规矩：full 必须给 height，否则底部露空挡）
        full: true,
        bg: 'images/heartgame/page/shelf.jpg',
        bgScrim: 'linear-gradient(180deg, rgba(255,250,252,0.30) 0%, rgba(255,247,251,0.44) 46%,'
          + ' rgba(248,246,255,0.60) 100%)',
        content: body,
        buttons: [{
          text: '新建作品', icon: 'sparkle', kind: 'primary',
          onClick: function () { UI.openBookForm(); }
        }]
      });
    },

    /** 兼容旧入口名（core 的 _purgeCaches、外部调用点都还可能在用） */
    openArcList: async function () { return UI.openShelf(); },

    // ------------------------------------------------------------------
    //  5.2 作品页（设定 + 目录）
    // ------------------------------------------------------------------

    /**
     * 作品页：作品设定 + 章节目录。
     * 用户要的「作品 → 目录 → 章节阅读 → 续写下一章」里的"目录"就是这一页。
     */
    openBook: async function (bookId) {
      var book = Book.resolve(bookId) || Book.active();
      if (!book) { UI.openShelf(); return; }
      Book.setActive(book.id);
      var boardSlot = 'story-book-' + book.id;

      function render() {
        var chapters = book.chapters || [];
        var body = H.el('div');

        // ---- 作品设定卡 ----
        var head = H.card({ accent: '#D97FA8', soft: '#FFEBF3', pad: 12 });
        head.style.marginBottom = '12px';
        var hrow = H.el('div');
        hrow.style.cssText = 'display:flex; gap:12px; align-items:flex-start;';
        hrow.appendChild(UI.coverNode(book, 62, 84));
        var hm = H.el('div');
        hm.style.cssText = 'flex:1; min-width:0;';
        var st = book.styleId ? H.styleById(book.styleId) : null;
        hm.innerHTML = '<div style="font-size:13.6px; font-weight:900; color:#553f4c;">' + U.esc(book.title) + '</div>'
          + '<div style="font-size:9.8px; color:#a99fae; margin-top:4px;">'
          + chapters.length + ' 章 · 已读 ' + Book.finishedCount(book) + ' 章 · 进度 '
          + U.round(Book.progress(book), 0) + '%</div>'
          + '<div style="font-size:10.6px; line-height:1.72; color:#8b8292; margin-top:7px;">'
          + U.esc(U.cut(book.synopsis || '（还没有梗概）', 90)) + '</div>'
          + '<div style="font-size:9.6px; color:#b08aa0; margin-top:6px;">'
          + '题材：' + U.esc(U.cut(book.theme || '未填', 24))
          + ' · 文风：' + U.esc(st ? st.name : '模型默认') + '</div>';
        hrow.appendChild(hm);
        head.appendChild(hrow);

        var editRow = H.el('div');
        editRow.style.cssText = 'display:flex; gap:7px; margin-top:10px;';
        var renameB = H.button('改设定', { kind: 'soft', pad: '6px 11px', size: 10.4, icon: 'edit', soft: '#F3EEFF', color: '#7d63a8' });
        renameB.onclick = function () {
          // H.prompt 是单字段输入卡，所以分两步问：先改名，再改梗概
          H.prompt({
            title: '作品名', icon: 'edit', accent: '#7d63a8', soft: '#F3EEFF',
            message: '改一个你一眼就认得出来的名字。',
            value: book.title, placeholder: '例如：雨夜重逢'
          }).then(function (v) {
            if (v === null) return;
            if (String(v).trim()) book.title = String(v).trim().slice(0, 40);
            return H.prompt({
              title: '梗概', icon: 'edit', accent: '#7d63a8', soft: '#F3EEFF',
              message: '一句话讲这部作品在讲什么（会作为后续续写的题材参考）。',
              value: book.synopsis || '', placeholder: '例如：分开三年后，他成了你的房东。'
            });
          }).then(function (v2) {
            if (v2 === undefined) return;          // 第一步取消了
            if (v2 !== null) book.synopsis = String(v2).trim().slice(0, 200);
            book.updatedAt = Date.now();
            K.save(true);
            H.closeAllLayers();
            setTimeout(function () { UI.openBook(book.id); }, 320);
          });
        };
        editRow.appendChild(renameB);

        if (book.migrated) {
          var mig = H.el('div');
          mig.style.cssText = 'display:flex; align-items:center; font-size:9.4px; color:#9a8f9e;';
          mig.textContent = '（由旧版篇章自动迁移）';
          editRow.appendChild(mig);
        }
        head.appendChild(editRow);
        body.appendChild(head);

        // ---- 目录 ----
        body.appendChild(H.sectionTitle('目录', { color: '#D97FA8', margin: '4px 0 9px' }));
        if (!chapters.length) {
          body.appendChild(H.empty('这部作品还没有章节。让 AI 写第一章。', { icon: 'book' }));
        }

        chapters.forEach(function (c, i) {
          var nodes = c.nodes || [];
          var finished = c.status === 'finished';
          var read = finished ? nodes.length : U.clamp(U.int(c.nodeIndex, 0) + (nodes.length ? 1 : 0), 0, nodes.length);
          var badge = finished
            ? '已完成'
            : (U.int(c.nodeIndex, 0) > 0 ? '读到 ' + (U.int(c.nodeIndex, 0) + 1) + '/' + nodes.length : '未读');

          var row = H.listRow({
            icon: 'book',
            color: finished ? '#9FB3D9' : '#D97FA8',
            soft: finished ? '#EDF2FB' : '#FFEBF3',
            title: '第 ' + (i + 1) + ' 章 · ' + (c.title || '未命名'),
            subtitle: badge + ' · ' + nodes.length + ' 个节点 · '
              + (c.synopsis ? U.cut(c.synopsis, 34) : '（还没有梗概）'),
            subtitleWrap: true,
            rightNode: (function () {
              var box = H.el('div');
              box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
              var go = H.button(finished ? '重看' : (U.int(c.nodeIndex, 0) > 0 ? '继续' : '开始读'), {
                kind: 'soft', pad: '5px 11px', size: 10.6, soft: '#FFEBF3', color: '#B0728F'
              });
              go.onclick = function (ev) {
                ev.stopPropagation();
                Book.setActive(book.id);
                K.state.story.activeChapterId = c.id;
                UI.play(book, c);
              };
              box.appendChild(go);
              if (U.int(c.nodeIndex, 0) > 0) {
                var replay = H.button('从头回看', {
                  kind: 'soft', pad: '5px 10px', size: 10.6, soft: '#EDF2FB', color: '#5f7aa8'
                });
                replay.onclick = function (ev) {
                  ev.stopPropagation();
                  Book.setActive(book.id);
                  K.state.story.activeChapterId = c.id;
                  UI.play(book, c, { replay: true });
                };
                box.appendChild(replay);
              }
              var tree = H.iconButton('branch', { size: 26, color: '#B79EDC', title: '分支树与存档' });
              tree.onclick = function (ev) { ev.stopPropagation(); UI.openBranchTree(book, c); };
              box.appendChild(tree);
              var del = H.iconButton('trash', { size: 26, color: '#c2607c', title: '删除本章' });
              del.onclick = function (ev) {
                ev.stopPropagation();
                H.confirm({
                  title: '删除章节', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
                  message: '删除「第 ' + (i + 1) + ' 章 · ' + (c.title || '') + '」？'
                    + '这一章的节点、存档点，以及它留在小手机里的消息都会一起消失。',
                  okText: '删除'
                }).then(function (ok) {
                  if (!ok) return;
                  Chapter.remove(book, c);
                  H.closeAllLayers();
                  setTimeout(function () { UI.openBook(book.id); }, 320);
                });
              };
              box.appendChild(del);
              return box;
            })()
          });
          row.onclick = function () {
            Book.setActive(book.id);
            K.state.story.activeChapterId = c.id;
            UI.play(book, c);
          };
          body.appendChild(row);
        });

        H.sheet({
          title: book.title,
          subtitle: '作品 · ' + chapters.length + ' 章',
          icon: 'book',
          height: '100%',
          slot: boardSlot,
          full: true,
          bg: 'images/heartgame/page/story.jpg',
          content: body,
          buttons: [{
            text: chapters.length ? '继续写下一章' : '写第一章',
            icon: 'sparkle', kind: 'primary', keepOpen: true,
            onClick: function (api, node) { UI.writeNext(book, api, node); }
          }, {
            text: '返回书架', icon: 'back', kind: 'soft',
            onClick: function () { UI.openShelf(); }
          }]
        });
      }

      render();
    },

    // ------------------------------------------------------------------
    //  5.3 生成表单卡片（新建作品 / 续写走向）
    // ------------------------------------------------------------------

    /**
     * 新建作品的生成表单。**卡片式**，不是行内输入框（用户明确要求），
     * 背景走生图（form.jpg），卡片本体是毛玻璃，保证文字压得住画面。
     * @param {string} [theme] 续写时的预填走向
     * @param {object} [book]  传了就是「续写这一章」而不是新建作品
     */
    openBookForm: async function (theme, book) {
      var b = book ? Book.resolve(book) : null;
      var isNew = !b;
      var info = b ? Book.continueInfo(b) : null;
      var body = H.el('div');

      // ---- 卡片本体 ----
      var card = H.el('div');
      card.style.cssText = 'position:relative; box-sizing:border-box; border-radius:20px; padding:16px 15px 15px;'
        + 'background:linear-gradient(165deg, rgba(255,253,254,0.90) 0%, rgba(255,247,251,0.86) 55%,'
        + ' rgba(248,245,255,0.88) 100%);'
        + 'border:1px solid rgba(216,160,190,0.34);'
        + 'box-shadow:0 16px 40px rgba(120,80,110,0.20), inset 0 1px 0 rgba(255,255,255,0.9);'
        + 'backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);';
      body.appendChild(card);

      var cap = H.el('div');
      cap.style.cssText = 'font-size:9.6px; letter-spacing:.2em; font-weight:800; color:#b08aa0;';
      cap.textContent = isNew ? 'NEW WORK' : ('CHAPTER ' + ((info ? info.index : 0) + 1));
      card.appendChild(cap);

      var title = H.el('div');
      title.style.cssText = 'font-size:14.5px; font-weight:900; color:#553f4c; margin-top:5px;';
      title.textContent = isNew ? '新建一部作品' : '继续写下一章';
      card.appendChild(title);

      var sub = H.el('div');
      sub.style.cssText = 'font-size:10.4px; line-height:1.72; color:#8b8292; margin-top:6px;';
      sub.textContent = isNew
        ? '给作品定一个题材，AI 会写出它的第一章（8 个节点）。之后每一章都能接着上一章的梗概继续写，'
          + '读到哪一章都不会断。'
        : ('「' + b.title + '」现在有 ' + (info ? info.count : 0) + ' 章。'
          + (info && info.lastSynopsis ? '上一章：' + U.cut(info.lastSynopsis, 46) : '')
          + ' 续写时会自动把前面所有章节的梗概喂给模型，保证接得上。');
      card.appendChild(sub);

      // ---- 题材 / 走向 ----
      var label = function (text, gap) {
        var l = H.el('div');
        l.style.cssText = 'font-size:10.6px; font-weight:800; color:#8b8292; margin:' + (gap || '12px') + ' 2px 6px;';
        l.textContent = text;
        return l;
      };

      card.appendChild(label(isNew ? '题材 / 主题' : '这一章的走向（可留空，交给 AI 自己接）'));
      var input = H.el('input', {
        type: 'text',
        placeholder: isNew ? '例如：分开三年后他突然出现在你楼下' : '例如：让两人在雨夜被迫独处'
      });
      input.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px;'
        + 'border:1px solid rgba(216,160,190,0.36); padding:10px 12px; font-size:12px; color:#5c4450;'
        + 'background:rgba(255,255,255,0.94); outline:none; font-family:inherit;';
      if (theme) input.value = theme;
      card.appendChild(input);

      var quick = H.el('div');
      quick.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;';
      var QUICK = isNew
        ? ['一场没有预告的重逢', '被困在同一间民宿', '他替你挡了一次酒', '身份暴露的那一夜', '久别之后的第一次通话']
        : ['把两人的关系往前推一步', '让他不得不坦白一件事', '一次谁都没准备好的道别', '把上一章的伏笔收回来'];
      QUICK.forEach(function (t) {
        var qb = H.button(t, { kind: 'soft', pad: '5px 10px', size: 10.4, soft: '#FFEBF3', color: '#B0728F' });
        qb.onclick = function () { input.value = t; };
        quick.appendChild(qb);
      });
      card.appendChild(quick);

      // ---- 文风选择器（复用 v1.5.41 的文风管理器） ----
      card.appendChild(label('文风（决定这一章的写法与篇幅）'));
      var styleBar = H.el('div');
      styleBar.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
      var pickedStyleId = isNew
        ? (K.state.activeStyleId || null)
        : (b.styleId === undefined ? null : b.styleId);
      var paintStyles = function () {
        styleBar.innerHTML = '';
        var rows = [{ id: null, name: '不指定', desc: '用模型默认写法' }].concat(K.allStyles());
        rows.forEach(function (s) {
          var on = pickedStyleId === s.id;
          var sb = H.el('button', { type: 'button', title: s.desc || s.prompt || '' });
          sb.style.cssText = 'padding:6px 11px; border-radius:11px; font-size:10.8px; font-weight:700; cursor:pointer;'
            + 'transition:all .18s ease;'
            + (on ? 'background:linear-gradient(135deg,#D97FA8,#B79EDC); color:#fff; border:none;'
              : 'background:rgba(255,255,255,0.86); color:#8b8292; border:1px solid rgba(190,180,195,0.28);');
          sb.textContent = s.name + (s.builtin === false ? ' ·自定义' : '');
          sb.onclick = function () {
            pickedStyleId = s.id;
            K.setActiveStyle(s.id);         // 顺手记成当前文风，下次进来还是它
            paintStyles();
          };
          styleBar.appendChild(sb);
        });
      };
      paintStyles();
      card.appendChild(styleBar);

      var hint = H.el('div');
      hint.style.cssText = 'font-size:9.8px; color:#a99fae; margin-top:7px; line-height:1.66;';
      hint.textContent = isNew
        ? '想自己写一套文风？去「后台管理 → 文风管理器」新增。'
        : '续写默认沿用这部作品的文风，也可以在这里临时换一套。';
      card.appendChild(hint);

      H.sheet({
        title: isNew ? '新建作品' : '续写下一章',
        subtitle: isNew ? 'AI 写出第一章' : ('第 ' + ((info ? info.index : 0) + 1) + ' 章'),
        icon: 'sparkle',
        height: '100%',
        slot: 'story-form',
        full: true,
        bg: 'images/heartgame/page/bookform.jpg',
        bgScrim: 'linear-gradient(180deg, rgba(255,252,250,0.26) 0%, rgba(255,248,246,0.40) 46%,'
          + ' rgba(250,246,255,0.56) 100%)',
        content: body,
        buttons: [{
          text: isNew ? '让 AI 写出这部作品' : '继续写下一章',
          icon: 'sparkle', kind: 'primary', keepOpen: true,
          onClick: async function (api, node) {
            var t = input.value.trim();
            if (isNew) {
              if (!t) { H.toast('先给作品写一个题材'); return; }
              await UI.createBook(t, pickedStyleId, api, node);
              return;
            }
            await UI.continueChapter(b, t, pickedStyleId, api, node);
          }
        }]
      });
    },

    /** 新建作品：生成第一章 → 建书 → 进目录 */
    createBook: async function (theme, styleId, api, node) {
      var restore = H.busy(node, '正在写…');
      H.toast('正在为你们写第一章…');
      var out = await Gen.generateChapter({ theme: theme, styleId: styleId, isNew: true, chapterNo: 0 });
      restore();
      if (!out) { UI.tip('没能写出这一章', '模型这次没有给出可用的章节。可以再点一次，或换一个题材描述。'); return; }
      var book = Book.create({
        title: out.title || theme,
        synopsis: out.synopsis || '',
        theme: theme,
        styleId: (styleId === undefined ? null : styleId)
      });
      if (!book) { H.toast('作品创建失败'); return; }
      var ch = Chapter.create(book, {
        title: out.title || ('第 1 章'),
        synopsis: out.synopsis || '',
        nodes: out.nodes,
        theme: theme
      });
      H.closeAllLayers();
      setTimeout(function () { UI.play(book, ch); }, 260);
    },

    /**
     * 续写下一章 → 直接进入阅读。
     * **带上前面所有章节的梗概**（在 Gen.chapterPlan 里拼），保证连贯。
     */
    continueChapter: async function (bookLike, direction, styleId, api, node) {
      var b = Book.resolve(bookLike);
      if (!b) { H.toast('找不到这部作品'); return; }
      var info = Book.continueInfo(b);
      var restore = H.busy(node, '正在写…');
      H.toast('正在接着写第 ' + (info.index + 1) + ' 章…');
      var out = await Gen.generateChapter({
        book: b,
        theme: direction || b.theme,
        styleId: styleId,
        chapterNo: info.index,
        isNew: false
      });
      restore();
      if (!out) { UI.tip('没能写出这一章', '模型这次没有给出可用的章节，作品进度没有变化。可以再点一次。'); return; }
      var ch = Chapter.create(b, {
        title: out.title || ('第 ' + (info.index + 1) + ' 章'),
        synopsis: out.synopsis || '',
        nodes: out.nodes,
        theme: b.theme
      });
      if (!ch) { H.toast('章节保存失败'); return; }
      H.closeAllLayers();
      setTimeout(function () { UI.play(b, ch); }, 260);
    },

    /** 从作品页底部按钮续写（带缓冲态） */
    writeNext: async function (bookLike, api, node) {
      var b = Book.resolve(bookLike);
      if (!b) return;
      var info = Book.continueInfo(b);
      var restore = H.busy(node, '正在写…');
      H.toast('正在接着写第 ' + (info.index + 1) + ' 章…');
      var out = await Gen.generateChapter({
        book: b, theme: b.theme, styleId: b.styleId, chapterNo: info.index, isNew: false
      });
      restore();
      if (!out) { UI.tip('没能写出这一章', '模型这次没有给出可用的章节，作品进度没有变化。可以再点一次，或换个文风。'); return; }
      var ch = Chapter.create(b, {
        title: out.title || ('第 ' + (info.index + 1) + ' 章'),
        synopsis: out.synopsis || '',
        nodes: out.nodes,
        theme: b.theme
      });
      if (!ch) { H.toast('章节保存失败'); return; }
      H.closeAllLayers();
      setTimeout(function () { UI.play(b, ch); }, 260);
    },

    /**
     * 播放一章。
     *   UI.play(book, chapter [, opts])  —— 新签名（推荐）
     *   UI.play(chapter [, opts])        —— 旧签名，作品由章节自己反查
     * opts.replay = true 表示"从头回看"，结束时回到原来的进度。
     */
    play: async function (bookLike, chapterLike, opts) {
      // ---- 参数归一（新旧两种调法都要能用） ----
      var book = null, chapter = null, o = {};
      if (looksLikeBook(bookLike)) {
        book = bookLike;
        if (looksLikeChapter(chapterLike)) chapter = chapterLike;
        else if (typeof chapterLike === 'string') chapter = Chapter.byId(chapterLike);
        if (!chapter) chapter = Chapter.active(book);
        o = opts || {};
      } else {
        chapter = Chapter.resolve(bookLike, chapterLike && !looksLikeChapter(chapterLike) ? chapterLike : undefined);
        o = (chapterLike && typeof chapterLike === 'object' && !looksLikeChapter(chapterLike)) ? chapterLike : (opts || {});
        book = (chapter && Book.byId(chapter.bookId)) || Book.resolve(bookLike) || Book.active();
      }
      var a = chapter;
      if (!a) { UI.openShelf(); return; }
      if (book) {
        Book.setActive(book.id);
        K.state.story.activeChapterId = a.id;
      }
      book = book || Book.resolve(a);
      UI._arc = a;
      UI._book = book;
      var replay = !!(o && o.replay);
      // 演出期间挂起看板重绘：看板一旦重绘就会 teardown 掉共用的 Portraits 单例，
      // 主线立绘会当场消失（用户反馈的"主线里立绘时不时消失"）
      if (window.heartGameApp && typeof window.heartGameApp.setSuspended === 'function') {
        window.heartGameApp.setSuspended(true);
      }
      // 回看：先把进度记下来，退出时还原（用户要的"可以多次回看播放"）
      var replayFrom = replay ? U.int(a.nodeIndex, 0) : null;
      if (replay) {
        a.nodeIndex = 0;
        a._replayDepth = U.int(a._replayDepth, 0) + 1;
      }

      var st = K.state;
      var host = H.el('div');
      host.style.cssText = 'position:relative; width:100%; height:100%; min-height:74vh;';

      // 浮层：自定义行为输入（挂 body，避免被裁）
      var overlay = H.el('div');
      overlay.style.cssText = 'position:fixed; inset:0; z-index:100600; padding:0; box-sizing:border-box;'
        + 'background:#1b1319; opacity:0; transition:opacity .3s ease;';
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.style.opacity = '1'; });

      var inner = H.el('div');
      inner.style.cssText = 'position:relative; width:100%; height:100%; max-width:520px; margin:0 auto;';
      overlay.appendChild(inner);
      inner.appendChild(host);

      Stage.mount(host);

      // 顶部条
      var topbar = H.el('div');
      topbar.style.cssText = 'position:absolute; left:0; right:0; top:0; z-index:6; padding:11px 13px;'
        + 'display:flex; align-items:center; gap:9px;'
        + 'background:linear-gradient(180deg, rgba(20,12,18,0.72) 0%, rgba(20,12,18,0) 100%);';
      var closeB = H.iconButton('close', { size: 32, color: '#fff', bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.22)' });
      closeB.onclick = function () { exit(); };
      topbar.appendChild(closeB);
      var topTitle = H.el('div');
      topTitle.style.cssText = 'flex:1; min-width:0;';
      topTitle.innerHTML = '<div style="font-size:12.5px; font-weight:800; color:#fff; white-space:nowrap;'
        + 'overflow:hidden; text-overflow:ellipsis;">' + U.esc((book ? book.title + ' · ' : '') + (a.title || '')) + '</div>'
        + '<div id="hg-vn-progress" style="font-size:9.6px; color:rgba(255,255,255,0.66); margin-top:2px;"></div>';
      topbar.appendChild(topTitle);
      // 小手机按**整部作品**打开（用户明确要求：整部作品一条线）
      var phoneB = H.iconButton('phone', { size: 32, color: '#fff', bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.22)', title: '剧情小手机' });
      phoneB.onclick = function () { SubPhone.open(book); };
      topbar.appendChild(phoneB);
      var treeB = H.iconButton('branch', { size: 32, color: '#fff', bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.22)', title: '分支树' });
      treeB.onclick = function () { UI.openBranchTree(book, a); };
      topbar.appendChild(treeB);
      var saveB = H.iconButton('save', { size: 32, color: '#fff', bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.22)', title: '存档点' });
      saveB.onclick = function () {
        var snap = Arc.save(a);
        H.toast(snap ? '已保存：' + snap.label : '保存失败');
      };
      topbar.appendChild(saveB);
      // 回到目录（用户要的"退出时回到目录而不是书架"）
      var tocB = H.iconButton('book', { size: 32, color: '#fff', bg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.22)', title: '返回目录' });
      tocB.onclick = function () {
        exit();
        setTimeout(function () { UI.openBook(book ? book.id : null); }, 320);
      };
      topbar.appendChild(tocB);
      inner.appendChild(topbar);

      // 叙事窗（v1.5.39 重做：**透明化**、字更小，只显示当前这一个分镜）
      // 用户：「对话框过于复杂了，我们要透明化，字体缩小一些，并且做好段落切分，
      //        基本一句话一个分镜，角色说话要单独分镜。」
      // 所以这里不再是一张白卡片，而是"文字直接落在画面上 + 一层柔和的可读性衬底"。
      var win = H.el('div');
      win.style.cssText = 'position:absolute; left:0; right:0; bottom:0; z-index:5; padding:0 14px 16px;';
      var winCard = H.el('div');
      winCard.style.cssText = 'position:relative; padding:34px 4px 6px; box-sizing:border-box;'
        + 'background:linear-gradient(180deg, rgba(18,12,20,0) 0%, rgba(18,12,20,0.30) 38%,'
        + ' rgba(18,12,20,0.46) 100%);'
        + 'border-radius:18px; cursor:pointer;';
      win.appendChild(winCard);
      // 推进提示（右下角的小三角）
      var nextHint = H.el('div');
      nextHint.style.cssText = 'position:absolute; right:8px; bottom:4px; font-size:10px;'
        + 'color:rgba(255,255,255,0.62); letter-spacing:.08em; pointer-events:none;';
      nextHint.textContent = '轻触继续';
      winCard.appendChild(nextHint);
      inner.appendChild(win);

      var body = H.el('div');
      var optsHost = H.el('div');
      optsHost.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:11px;';

      var exit = function () {
        if (exit._closed) return;      // 关闭按钮与 closeAllLayers 可能同时来，防重入
        exit._closed = true;
        overlay.style.opacity = '0';
        // 回看模式：把进度还原回进来之前，存档点/分支不会因为"重看一遍"被改乱
        if (replay && replayFrom !== null) {
          a.nodeIndex = replayFrom;
          K.save();
        }
        // 自建浮层从登记表里摘掉，避免留下死引用
        if (HG.H && HG.H.forgetLayer) { try { HG.H.forgetLayer(overlay); } catch (e) { } }
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          if (HG.Portraits) { try { HG.Portraits.teardown(); } catch (e) { } }
          // 恢复看板重绘：挂起期间的请求会被合并成这一次
          if (window.heartGameApp && typeof window.heartGameApp.setSuspended === 'function') {
            window.heartGameApp.setSuspended(false);
          }
          // 复挂主页立绘：不做这一步，"从主线返回后看板立绘消失"就会一直复现
          remountLobbyPortrait();
        }, 300);
      };

      // 这个 overlay 是**自建**的（不走 H._layer），必须登记进浮层体系：
      // 否则 H.closeAllLayers() 根本关不掉它 —— 用户反馈的「有些弹窗不会自己关闭」里，
      // 主线就是最典型的一个。
      if (HG.H && HG.H.registerLayer) HG.H.registerLayer(overlay, function () { exit(); }, 'story-play');

      // 当前节点的分镜（一句话一个）与游标
      var segs = [];
      var segIdx = 0;
      var curNode = null;
      var curProfile = null;

      /**
       * 点击叙事窗：**先把分镜走完，再推进剧情**。
       * 这正是用户要的"一句话一个分镜"——一句话一次轻触，节奏由玩家自己控制。
       */
      winCard.onclick = function (e) {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;
        if (winCard._hasOptions) return;
        if (segIdx < segs.length - 1) { segIdx++; paintSegment(); return; }
        advanceFlow();
      };

      /** 画当前这一个分镜：旁白与台词分开呈现（角色说话单独分镜） */
      function paintSegment() {
        body.innerHTML = '';
        var seg = segs[segIdx];
        if (!seg) return;
        var isSpeech = seg.kind === 'speech';
        var box = H.el('div');
        box.style.cssText = isSpeech
          ? 'font-size:13.2px; line-height:1.72; color:#fff; font-weight:600;'
          : 'font-size:12.1px; line-height:1.76; color:rgba(255,255,255,0.90);';
        // 透明化之后靠文字投影保证可读性（不再压一张白卡片）
        box.style.textShadow = '0 1px 8px rgba(0,0,0,0.55), 0 2px 18px rgba(0,0,0,0.42)';
        if (isSpeech) {
          var who = H.el('div');
          who.style.cssText = 'font-size:10px; font-weight:800; letter-spacing:.18em; color:#F2C7DA; margin-bottom:5px;';
          who.textContent = (curProfile && curProfile.name) || 'TA';
          box.appendChild(who);
        }
        var txt = H.el('div');
        txt.style.cssText = 'white-space:pre-wrap;';
        txt.textContent = seg.text;
        box.appendChild(txt);
        body.appendChild(box);
        nextHint.textContent = (segIdx < segs.length - 1) ? ('轻触继续 · ' + (segIdx + 1) + '/' + segs.length) : '';
      }

      /** 分镜走完之后：有选项就先出选项，否则推进到下一个节点 */
      function advanceFlow() {
        var node = curNode;
        if (node && !winCard._optionsShown && !winCard._hasOptions
          && a.nodeIndex < a.nodes.length - 1 && (node.options || []).length) {
          showOptions(node);
          return;
        }
        var next = Arc.advance(a);
        if (!next) {
          finishArc(a, inner, body, optsHost, winCard, exit);
          return;
        }
        renderNode();
      }

      // ------------------------------------------------------------------
      // 节点渲染
      // ------------------------------------------------------------------
      async function renderNode() {
        var node = Arc.node(a);
        if (!node) { finishArc(a, inner, body, optsHost, winCard, exit); return; }
        curNode = node;
        var profile = await K.charProfile();
        curProfile = profile;
        await K.userProfile();

        var prog = document.getElementById('hg-vn-progress');
        if (prog) {
          var chNo = book ? (U.int(a.index, 0) + 1) : 0;
          prog.textContent = (chNo ? ('第 ' + chNo + ' 章 · ') : '')
            + (node.title || '') + ' · ' + (U.int(a.nodeIndex, 0) + 1) + ' / ' + a.nodes.length;
        }

        Stage.setBackground(node.bg);
        Stage.setEmotion(node.emotion);
        // 剧情小手机内容自动落库
        if (Script.isPhoneKind(node.kind)) {
          SubPhone.capture(node, a);
          H.toast(node.kind === 'sms' ? '手机震了一下…' : (node.kind === 'call' ? '有电话打进来' : 'TA 发了朋友圈'));
        }

        winCard._hasOptions = false;
        winCard._optionsShown = false;
        body.innerHTML = '';
        optsHost.innerHTML = '';

        // 拆分成「一句话一个分镜」；「…」里的角色台词单独成镜
        segs = Script.splitSegments(node.text);
        if (!segs.length) segs = [{ kind: 'narration', text: '' }];
        segIdx = 0;

        if (node.title) {
          var t = H.el('div');
          t.style.cssText = 'font-size:10px; letter-spacing:.2em; color:#F2C7DA; font-weight:800; margin-bottom:7px;'
            + 'text-shadow:0 1px 8px rgba(0,0,0,0.6);';
          t.textContent = node.title;
          body.appendChild(t);
        }
        paintSegment();
      }

      /**
       * 出选项（分镜全部走完之后）
       * 攻略模式：系统分支 + **永远可用的自由输入**（用户要的"选项可以自己写"）；
       * 被攻略模式：User 设定的抉择交给 Char 自主选择。
       */
      function showOptions(node) {
        winCard._optionsShown = true;
        winCard._hasOptions = true;
        optsHost.innerHTML = '';
        nextHint.textContent = '';
        if (K.isReverse()) {
          // 反向模式：User 已设定的抉择，交给 Char 自主选择
          var hint = H.el('div');
          hint.style.cssText = 'font-size:10.4px; color:rgba(255,255,255,0.78); text-align:center; margin-bottom:7px;'
            + 'text-shadow:0 1px 8px rgba(0,0,0,0.5);';
          hint.textContent = '以下抉择由你设定，TA 会依自己的性格做出选择';
          optsHost.appendChild(hint);
          (node.options || []).forEach(function (o) {
            var rowEl = H.el('div');
            rowEl.style.cssText = 'border-radius:14px; padding:10px 12px; box-sizing:border-box;'
              + 'background:rgba(28,20,30,0.52); border:1.2px dashed rgba(240,196,216,0.5);';
            rowEl.innerHTML = '<div style="font-size:12px; color:#fff; line-height:1.6;">' + U.esc(o.text) + '</div>'
              + '<div style="display:flex; gap:6px; margin-top:6px;">'
              + '<span style="font-size:9.6px; font-weight:800; color:#F2C7DA;">'
              + '好感 ' + (o.affinityDelta >= 0 ? '+' : '') + o.affinityDelta + '</span>'
              + '<span style="font-size:9.6px; font-weight:800; color:#C9B6EE;">'
              + '裁定 ' + (o.verdictDelta >= 0 ? '+' : '') + o.verdictDelta + '</span>'
              + '</div>';
            optsHost.appendChild(rowEl);
          });
          var decideB = H.button('让 TA 做选择', { kind: 'primary', block: true, icon: 'dice', color: '#B79EDC', color2: '#D97FA8' });
          decideB.onclick = function () { UI.resolveReverseChoice(a, node, body, optsHost, winCard); };
          optsHost.appendChild(decideB);
        } else {
          // 小手机剧情：**只出手机回复界面**，不再把同一批 options 又渲染成普通分支按钮
          // （用户 2026-09-11：小手机分支会和原本的剧情分支重复，删掉一个）
          var phoneNode = Script.isPhoneKind(node.kind);
          if (phoneNode) {
            SubPhone.buildReplyOptions(node, optsHost, function (text) {
              SubPhone.pushUserReply(text, node, a);
              UI.resolveFreeAction(a, node, text, body, optsHost, winCard);
            }, { hideCandidates: (node.options || []).length > 0 ? false : false });
          } else {
            (node.options || []).forEach(function (o) {
              var b = H.button(o.text, {
                kind: 'soft', block: true, color: '#8f6a80', soft: 'rgba(255,241,247,0.94)',
                pad: '11px 13px', size: 12
              });
              b.style.textAlign = 'left';
              b.style.justifyContent = 'flex-start';
              b.onclick = function () { UI.resolveChoice(a, node, o, body, optsHost, winCard); };
              optsHost.appendChild(b);
            });
          }

          // 自由行动输入框：**总是出现**（用户要的"选项由自己输入"）
          var freeWrap = H.el('div');
          freeWrap.style.cssText = 'display:flex; gap:7px; margin-top:4px;';
          var freeInput = H.el('input', { type: 'text', placeholder: '或者，自己写一个动作 / 一句话…' });
          freeInput.style.cssText = 'flex:1; box-sizing:border-box; border-radius:12px; border:1px solid rgba(240,196,216,0.42);'
            + 'padding:9px 11px; font-size:11.8px; color:#3a3040; background:rgba(255,255,255,0.94); outline:none;'
            + 'font-family:inherit;';
          freeWrap.appendChild(freeInput);
          var freeB = H.iconButton('send', { size: 36, color: '#fff', bg: 'linear-gradient(135deg,#D97FA8,#B79EDC)', border: 'none' });
          freeB.onclick = function () {
            var act = freeInput.value.trim();
            if (!act) { H.toast('先写点什么'); return; }
            UI.resolveFreeAction(a, node, act, body, optsHost, winCard);
          };
          freeInput.onkeydown = function (e) { if (e.key === 'Enter') freeB.onclick(); };
          freeWrap.appendChild(freeB);
          optsHost.appendChild(freeWrap);
        }
      }


      winCard.appendChild(body);
      winCard.appendChild(optsHost);
      renderNode();
    },

    /** 攻略模式：选分支 */
    resolveChoice: async function (arc, node, option, body, optsHost, winCard) {
      if (UI._busy) return;
      UI._busy = true;
      optsHost.innerHTML = '';
      optsHost.appendChild(H.loading('TA 正在回应…'));

      Arc.recordChoice(arc, node, option);
      var res = K.addAffinity(option.affinityDelta || 0, { reason: '剧情选择：' + U.cut(option.text, 16) });
      if (option.verdictDelta) K.nudgeVerdict(option.verdictDelta, { note: '剧情选择' });

      var text = option.result;
      if (!text) {
        var prompt = await Gen.baseSystem(
          '当前场景：' + (node.scene || '') + '\n节点正文：' + U.cut(node.text, 200) + '\n\n'
          + '玩家刚刚选择了：「' + option.text + '」\n\n'
          + '请写这个选择之后发生了什么，70~130 字，要有具体的身体反应或一句直接引语。不要旁白腔。'
        );
        text = await K.ask(prompt, { temperature: 0.95 });
        if (!text) text = '你做了这个选择。空气安静了一瞬，随后是他没有完全藏住的一点反应。';
      }
      text = String(text).replace(/^["「『]|["」』]$/g, '').trim();

      node.resolved = { choiceId: option.id, text: text, at: Date.now() };
      optsHost.innerHTML = '';

      // 飘字
      if (res.applied) {
        H.floatText((res.applied > 0 ? '+' : '') + res.applied + ' 心动', {
          host: winCard, x: '50%', y: '16%', color: res.applied > 0 ? '#D97FA8' : '#7E97C9'
        });
      }
      winCard._hasOptions = false;

      // 结算气泡
      var card = H.el('div');
      card.style.cssText = 'border-radius:15px; padding:11px 12px; font-size:12.2px; line-height:1.82;'
        + 'color:#5c4450; background:linear-gradient(150deg,rgba(255,255,255,0.98),rgba(255,246,250,0.9));'
        + 'border:1px solid rgba(216,160,190,0.24); white-space:pre-wrap;';
      card.textContent = text;
      body.appendChild(card);

      if (res.gated) {
        UI.offerGate(arc, body, optsHost, winCard, res);
      } else if (res.tierUp) {
        UI.announceTier(body);
      }

      // 记忆回流
      Gen.persistMemory(arc, node).catch(function () { });
      UI._busy = false;
    },

    /** 攻略模式：自由行动推演 */
    resolveFreeAction: async function (arc, node, action, body, optsHost, winCard) {
      if (UI._busy) return;
      UI._busy = true;
      optsHost.innerHTML = '';
      optsHost.appendChild(H.loading('正在推演你的动作…'));

      var out = await Gen.freeAction(node, action);
      optsHost.innerHTML = '';
      winCard._hasOptions = false;

      var res = K.addAffinity(out.affinityDelta, { reason: '自由行动：' + U.cut(action, 16) });
      if (out.verdictDelta) K.nudgeVerdict(out.verdictDelta, { note: '自由行动' });
      Arc.recordChoice(arc, node, { id: 'free', text: action, affinityDelta: out.affinityDelta });

      var mine = H.bubble({ side: 'user', text: action, name: '你' });
      body.appendChild(mine);

      if (res.applied) {
        H.floatText((res.applied > 0 ? '+' : '') + res.applied + ' 心动', {
          host: winCard, x: '50%', y: '18%', color: res.applied > 0 ? '#D97FA8' : '#7E97C9'
        });
      }
      var profile = await K.charProfile();
      body.appendChild(H.bubble({
        side: 'char', text: out.text, name: profile.name,
        avatarNode: H.avatar(profile.avatar, profile.name, 30)
      }));
      Stage.setEmotion(out.emotion);

      if (res.gated) UI.offerGate(arc, body, optsHost, winCard, res);
      else if (res.tierUp) UI.announceTier(body);

      Gen.persistMemory(arc, node).catch(function () { });
      UI._busy = false;
    },

    /** 反向模式：Char 自主选择 */
    resolveReverseChoice: async function (arc, node, body, optsHost, winCard) {
      if (UI._busy) return;
      UI._busy = true;
      optsHost.innerHTML = '';
      optsHost.appendChild(H.loading('TA 正在做决定…'));

      var decided = await Gen.charDecide(node);
      var profile = await K.charProfile();
      var chosen = (node.options || [])[decided.choiceIndex];

      winCard._hasOptions = false;
      optsHost.innerHTML = '';
      Arc.recordChoice(arc, node, chosen || { id: 'auto', text: '（未选）' });

      // 结算：Char 的选择影响 User 对 Char 的裁定 + 好感
      if (chosen) {
        K.nudgeVerdict(chosen.verdictDelta || 0, { note: 'TA 的自主选择' });
        K.addAffinity(chosen.affinityDelta || 0, { reason: 'TA 的选择：' + U.cut(chosen.text, 14) });
      }

      var pickBox = H.el('div');
      pickBox.style.cssText = 'border-radius:15px; padding:11px 12px; margin-bottom:9px;'
        + 'background:linear-gradient(150deg,#F3EEFF,#FFEBF3); border:1.3px solid rgba(183,158,220,0.4);';
      pickBox.innerHTML = '<div style="font-size:10px; letter-spacing:.14em; color:#7d63a8; font-weight:800;'
        + 'margin-bottom:6px;">TA 的选择</div>'
        + '<div style="font-size:12.2px; color:#553f4c; line-height:1.7;">'
        + U.esc(chosen ? chosen.text : '（TA 沉默了）') + '</div>'
        + (decided.reason ? '<div style="font-size:10.6px; color:#8b8292; margin-top:8px; line-height:1.7;'
          + 'font-style:italic;">内心独白：' + U.esc(decided.reason) + '</div>' : '');
      body.appendChild(pickBox);

      var text = chosen && chosen.result ? chosen.result : '';
      if (!text) {
        var prompt = await Gen.baseSystem(
          '你在扮演 ' + profile.name + '（玩家视角）。\n'
          + '局面前提：' + U.cut(node.text, 200) + '\n'
          + '你刚刚选择了：「' + (chosen ? chosen.text : '沉默') + '」\n'
          + '你的内心独白：' + decided.reason + '\n\n'
          + '请写你做出这个选择之后的场面与你说出口的话，70~130 字，第一人称，'
          + '带一点玩家特有的情绪（讨好 / 逞强 / 破防 / 占有欲）。不要旁白腔。'
        );
        text = await K.ask(prompt, { temperature: 0.95 });
        if (!text) text = '他做了这个选择，然后看着你，等你给一个反应。';
      }
      body.appendChild(H.bubble({
        side: 'char', text: String(text).trim(), name: profile.name,
        avatarNode: H.avatar(profile.avatar, profile.name, 30)
      }));
      Stage.setEmotion(decided.emotion);

      Gen.persistMemory(arc, node).catch(function () { });
      UI._busy = false;
    },

    /** 晋阶任务：满槽时解锁下一阶梯 */
    offerGate: function (arc, body, optsHost, winCard, res) {
      var tier = K.tier();
      var card = H.el('div');
      card.style.cssText = 'margin-top:11px; border-radius:16px; padding:13px; text-align:center;'
        + 'background:linear-gradient(150deg,#FFF1F7,#F3EEFF); border:1.4px solid rgba(217,127,168,0.45);'
        + 'box-shadow:0 10px 26px rgba(217,127,168,0.18);';
      card.innerHTML = '<div style="font-size:12.5px; font-weight:900; color:#B0728F;">'
        + '「' + tier.name + '」的经验槽已经满了</div>'
        + '<div style="font-size:10.8px; color:#9a8f9e; margin-top:6px; line-height:1.7;">'
        + '完成一次晋阶任务，就能推开下一阶梯的门。</div>';
      var b = H.button('完成晋阶任务', { kind: 'primary', block: true, icon: 'key' });
      b.style.marginTop = '11px';
      b.onclick = async function () {
        var prompt = await Gen.baseSystem(
          '当前关系阶段是「' + tier.name + '」，经验槽已满，需要一次「晋阶任务」来推进关系。\n'
          + '请设计一个简短有力、只属于你们两人的晋阶任务（20~40 字），'
          + '要求是一个具体动作或一次坦白，而不是抽象的承诺。\n'
          + '直接输出任务描述，不要任何其它内容。'
        );
        var task = await K.ask(prompt, { temperature: 0.95 });
        if (!task) task = '当面把「我在意你」这四个字说清楚，不许用玩笑带过。';
        var ok = await H.confirm({
          title: '晋阶任务',
          icon: 'key', accent: '#B79EDC', soft: '#F3EEFF',
          message: String(task).trim() + '\n\n完成它，关系会推进到下一阶梯。',
          okText: '我完成了'
        });
        if (!ok) return;
        K.completeGate(tier.key);
        var t2 = K.tier();
        H.modal({
          title: '阶梯推进',
          icon: 'sparkle', accent: t2.color, soft: '#FFEBF3',
          message: '你们的关系进入了「' + t2.name + '」。\n\n' + t2.desc
        });
        UI.announceTier(body);
      };
      card.appendChild(b);
      body.appendChild(card);
    },

    announceTier: function (body) {
      var tier = K.tier();
      var banner = H.el('div');
      banner.style.cssText = 'margin-top:11px; border-radius:16px; padding:13px; text-align:center;'
        + 'background:linear-gradient(150deg,' + tier.color + '22, rgba(255,255,255,0.9));'
        + 'border:1.4px solid ' + tier.color + '66; animation:hg-rise .5s cubic-bezier(.22,1,.36,1) both;';
      banner.innerHTML = '<div style="font-size:12.5px; font-weight:900; color:' + tier.color + ';">'
        + '阶梯推进 · ' + tier.name + '</div>'
        + '<div style="font-size:10.8px; color:#9a8f9e; margin-top:6px; line-height:1.7;">' + tier.desc + '</div>';
      body.appendChild(banner);
    },

    /**
     * 本章读完的收束屏。
     * 小说化的关键就在这一屏：**读完一章不是结束**，主按钮是「继续写下一章」，
     * 写完直接接着演。用户原话：「章节都可以继续生成，这样才是连贯的」。
     */
    finishArc: function (arc, inner, body, optsHost, winCard, exitFn) {
      winCard._hasOptions = false;
      body.innerHTML = '';
      optsHost.innerHTML = '';
      var tier = K.tier();
      var bk = Book.byId(arc.bookId) || UI._book || Book.resolve(arc);
      var chNo = bk ? (U.int(arc.index, 0) + 1) : 0;

      var box = H.el('div');
      box.style.cssText = 'text-align:center; padding:8px 4px 2px;';
      box.innerHTML = '<div style="font-size:13px; font-weight:900; color:#B0728F; margin-bottom:8px;">'
        + (chNo ? '第 ' + chNo + ' 章完' : '本章完') + '</div>'
        + '<div style="font-size:11.4px; font-weight:800; color:#553f4c; margin-bottom:6px;">'
        + U.esc(arc.title || '') + '</div>'
        + '<div style="font-size:10.8px; color:#9a8f9e; line-height:1.76;">'
        + (arc.synopsis ? U.esc(arc.synopsis) + '<br>' : '')
        + '当前阶段：' + tier.name + ' · 好感 ' + U.comma(K.state.affinity) + '</div>';
      body.appendChild(box);

      var bNext = H.button('继续写下一章', { kind: 'primary', block: true, icon: 'sparkle' });
      bNext.style.marginTop = '12px';
      bNext.onclick = function () {
        if (!bk) { H.toast('找不到这部作品'); return; }
        exitFn();
        setTimeout(function () { UI.writeNext(bk, null, null); }, 340);
      };
      body.appendChild(bNext);

      var b1 = H.button('把这一章写进记忆回廊', { kind: 'soft', block: true, icon: 'heart', soft: '#FFEBF3', color: '#B0728F' });
      b1.style.marginTop = '8px';
      b1.onclick = function () {
        var quotes = (arc.nodes || []).slice(-3).map(function (n) { return U.cut(n.text, 60); });
        K.addMemory({
          title: (bk ? bk.title + ' · ' : '') + (arc.title || ''),
          summary: arc.synopsis || ('一段走到了结尾的剧情 · ' + (arc.nodes || []).length + ' 个节点'),
          quotes: quotes,
          source: 'story',
          tags: ['主线', tier.name]
        });
        H.toast('已存入记忆回廊');
        Gen.persistMemory(arc, null).catch(function () { });
      };
      body.appendChild(b1);

      var b2 = H.button('返回目录', { kind: 'soft', block: true, icon: 'book', soft: '#F3EEFF', color: '#7d63a8' });
      b2.style.marginTop = '8px';
      b2.onclick = function () {
        exitFn();
        setTimeout(function () { UI.openBook(bk ? bk.id : null); }, 320);
      };
      body.appendChild(b2);
    },

    /** 分支树可视化 + 回溯（按章节；z 100700 才能盖在演出之上） */
    openBranchTree: function (bookLike, chapterLike) {
      var bk = looksLikeBook(bookLike) ? bookLike : (Book.resolve(bookLike) || UI._book || Book.active());
      var a = null;
      if (looksLikeChapter(chapterLike)) a = chapterLike;
      else if (chapterLike !== undefined) a = Chapter.byId(chapterLike);
      if (!a) a = (looksLikeBook(bookLike) ? Chapter.active(bookLike) : Chapter.resolve(bookLike)) || UI._arc || Chapter.active(bk);
      var st = K.state;
      var body = H.el('div');
      if (!a) { body.appendChild(H.empty('先开启一部作品', { icon: 'branch' })); return H.sheet({ title: '分支树', content: body }); }
      if (!bk) bk = Book.byId(a.bookId);

      var mine = (st.story.branches || []).filter(function (b) {
        return (b.chapterId || b.arcId) === a.id;
      });
      var info = H.el('div');
      info.style.cssText = 'font-size:10.8px; color:#8b8292; line-height:1.72; margin-bottom:12px;'
        + 'background:rgba(255,255,255,0.72); border-radius:13px; padding:11px 12px;';
      info.innerHTML = (bk ? U.esc(bk.title) + ' · ' : '') + '第 ' + (U.int(a.index, 0) + 1) + ' 章「'
        + U.esc(a.title || '') + '」共 ' + (a.nodes || []).length + ' 个节点，'
        + '当前停在第 ' + (U.int(a.nodeIndex, 0) + 1) + ' 个。<br>'
        + '已记录 ' + mine.length + ' 次选择，' + (a.saves || []).length + ' 个存档点。';
      body.appendChild(info);

      // 节点主干
      body.appendChild(H.sectionTitle('节点主干', { color: '#D97FA8' }));
      var rail = H.el('div');
      rail.style.cssText = 'position:relative; padding-left:20px; margin-bottom:14px;';
      var line = H.el('div');
      line.style.cssText = 'position:absolute; left:6px; top:6px; bottom:6px; width:2px;'
        + 'background:linear-gradient(180deg,#D97FA8,#B79EDC);border-radius:2px; opacity:.35;';
      rail.appendChild(line);
      (a.nodes || []).forEach(function (n, i) {
        var here = i === U.int(a.nodeIndex, 0);
        var past = i < U.int(a.nodeIndex, 0);
        var dot = H.el('div');
        dot.style.cssText = 'position:relative; margin-bottom:9px; padding:8px 11px; border-radius:12px;'
          + 'cursor:pointer; transition:all .2s ease;'
          + (here ? 'background:linear-gradient(135deg,#FFF1F7,#F3EEFF); border:1.3px solid rgba(217,127,168,0.6);'
            : 'background:rgba(255,255,255,0.66); border:1px solid rgba(190,180,195,0.22);')
          + (past ? ' opacity:.72;' : '');
        dot.innerHTML = '<div style="display:flex; align-items:center; gap:6px;">'
          + '<span style="font-size:9.6px; font-weight:900; color:' + (here ? '#D97FA8' : '#a99fae') + ';">'
          + ('0' + (i + 1)).slice(-2) + '</span>'
          + '<span style="font-size:11.4px; font-weight:700; color:#5c4450;">' + U.esc(n.title) + '</span>'
          + (here ? '<span style="font-size:9px; font-weight:900; color:#fff; background:#D97FA8;'
            + 'padding:1px 6px; border-radius:7px; margin-left:auto;">当前</span>' : '')
          + '</div>'
          + '<div style="font-size:10px; color:#a99fae; margin-top:3px; white-space:nowrap; overflow:hidden;'
          + 'text-overflow:ellipsis;">' + U.esc(U.cut(n.text, 34)) + '</div>';
        dot.onclick = function () {
          a.nodeIndex = i;
          a.status = 'playing';
          K.save(true);
          H.toast('已回到节点：' + n.title);
        };
        rail.appendChild(dot);
      });
      body.appendChild(rail);

      // 选择记录
      body.appendChild(H.sectionTitle('选择记录（点任意一条回溯）', { color: '#B79EDC' }));
      if (!mine.length) body.appendChild(H.empty('还没有记录到选择。', { icon: 'branch' }));
      mine.slice().reverse().forEach(function (b) {
        var row = H.listRow({
          icon: 'branch', color: '#B79EDC', soft: '#F3EEFF',
          title: b.choiceText || '（自由行动）',
          subtitle: (b.nodeTitle || '') + ' · 好感 ' + (b.affinityDelta >= 0 ? '+' : '') + b.affinityDelta
            + (b.verdictDelta ? ' · 裁定 ' + (b.verdictDelta >= 0 ? '+' : '') + b.verdictDelta : '')
            + ' · ' + U.timeAgo(b.at),
          subtitleWrap: true,
          rightNode: H.button('回溯', { kind: 'soft', pad: '5px 10px', size: 10.4, soft: '#F3EEFF', color: '#7d63a8' })
        });
        row.onclick = function () {
          if (!Arc.rewindTo(b.id)) { H.toast('回溯失败'); return; }
          H.toast('已回溯到该选择点');
          H.closeAllLayers();
          UI.play(bk, Chapter.byId(b.chapterId || b.arcId));
        };
        body.appendChild(row);
      });

      // 存档点
      body.appendChild(H.sectionTitle('存档点', { color: '#7E97C9' }));
      var saveNow = H.button('存一个新档', { kind: 'primary', block: true, icon: 'save' });
      saveNow.onclick = function () {
        var snap = Arc.save(a);
        H.toast(snap ? '已存档：' + snap.label : '存档失败');
        H.closeAllLayers();
        UI.openBranchTree(bk, a);
      };
      body.appendChild(saveNow);
      (a.saves || []).forEach(function (s) {
        var row = H.listRow({
          icon: 'save', color: '#7E97C9', soft: '#EDF2FB',
          title: s.label,
          subtitle: '节点 ' + (U.int(s.nodeIndex, 0) + 1) + ' · 好感 ' + U.comma(s.affinity) + ' · ' + U.timeFull(s.at),
          subtitleWrap: true,
          rightNode: H.button('读取', { kind: 'soft', pad: '5px 10px', size: 10.4, soft: '#EDF2FB', color: '#5f7aa8' })
        });
        row.onclick = function () {
          if (!Arc.load(a, s.id)) { H.toast('读档失败'); return; }
          H.toast('已回到存档点');
          H.closeAllLayers();
          UI.play(bk, a);
        };
        body.appendChild(row);
      });

      H.sheet({
        title: '分支树与存档',
        subtitle: (bk ? bk.title + ' · ' : '') + (a.title || ''),
        icon: 'branch',
        height: '92%',
        // 同样要盖在主线演出之上
        z: 100700,
        slot: 'story-tree',
        content: body,
        buttons: [{
          text: '回到这一章', icon: 'play', kind: 'primary',
          onClick: function () { H.closeAllLayers(); UI.play(bk, a); }
        }]
      });
    }
  };

  HG.Story = {
    Book: Book,
    Chapter: Chapter,
    Arc: Arc,          // 兼容层：旧的「篇章」= 新模型的一章
    Gen: Gen,
    SubPhone: SubPhone,
    Stage: Stage,
    UI: UI,
    Script: Script,
    open: function () { UI.openShelf(); }
  };
})();
