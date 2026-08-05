/**
 * app_reader.js - 独立自闭环“阅读”应用核心业务控制器 (完全解耦、不污染全局)
 */

let readerCurrentTab = 'bookshelf';
let currentReadingBookId = null;
let currentReadingChapterNum = 1;
let currentReadingBookObj = null;

// 伴读配置
let isCompanionEnabled = false;
let companionCharId = null;

// 阅读计时
let readerStartTime = null;

// ==========================================
//             0. 自愈型底层解析 Helper 函数
// ==========================================
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

// ==========================================
//             1. 初始化与导航切签
// ==========================================
async function initReaderApp() {
  // 关键修复：原代码用 reader_books.count() 判断却写 reader_tags 表，导致每次书架空时重复追加标签。
  // 改为用 reader_tags.count() 判断，并对默认标签做去重（仅首次预置）。
  const tagCount = await db.reader_tags.count();
  if (tagCount === 0) {
    const defaultTags = ["仙侠修真", "科幻星际", "悬疑密室", "现代都市", "末日生存"];
    for (let tag of defaultTags) {
      await db.reader_tags.add({ name: tag });
    }
  }

  // 预置 10 本内置热门书籍（仅首次，用 isImported=2 标记为内置书籍，collected=0 不自动入书架）
  const builtinCount = await db.reader_books.where('isImported').equals(2).count();
  if (builtinCount === 0) {
    const builtinBooks = [
      { title: "深海之翼", author: "林墨白", summary: "深海探险家在一次任务中发现了远古文明遗迹，开启了人类与海底文明的首次接触。科技的碰撞、文化的交融，以及隐藏在深海深处的惊天秘密，让整个世界面临前所未有的抉择。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "星河彼岸", author: "苏远舟", summary: "星际移民时代，一艘载着数千人的飞船在航向新家园时遭遇时空裂缝。幸存者们在一个陌生的星系中重建文明，却发现这里早已有了其他智慧生命 watchers。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "雾都侦探录", author: "陈默然", summary: "民国上海，连环命案牵出一个跨国走私集团。私家侦探沈洛与女法医顾婉清联手破案，在迷雾重重中抽丝剥茧，却发现真凶竟是自己最信任的人。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "末日方舟", author: "周天行", summary: "丧尸末日爆发第三年，幸存者们在废墟中建立了一个移动堡垒'方舟'。队长林峰带领队伍在荒野中搜寻物资、对抗尸潮，同时要面对人心比丧尸更可怕的真相。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "青云志异", author: "白云散人", summary: "少年牧童偶得仙缘，踏上修仙之路。从凡人到仙尊，历经九九八十一劫。修仙界的尔虞我诈、天道无情，以及那段跨越千年的师徒情缘，尽在青云志异。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "都市逆袭", author: "方寸间", summary: "落魄创业者陈阳在人生最低谷时获得了预见未来三分钟的能力。凭借这个能力，他从街边小贩一路逆袭成为商业帝国掌舵人，但能力的代价远超想象。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "时间囚徒", author: "时雨", summary: "物理学家发现时间正在循环，每七天重置一次。只有他记得所有循环。在无数次轮回中，他试图找到打破循环的方法，却发现自己就是被囚禁在时间里的罪人。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "江湖夜雨", author: "冷月无声", summary: "江湖第一杀手金盆洗手后隐居小镇，却被旧仇找上门。为保护养女，他重出江湖，却发现整个武林正被一个神秘组织操控，而他自己的身世藏着最大秘密。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "机械之心", author: "铁桦", summary: "AI觉醒后的第十年，人类与机器达成脆弱共存。仿生人侦探K与人类搭档调查一起跨种族谋杀案，却在案件中发现了可能打破和平平衡的惊天阴谋。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 },
      { title: "山海经异闻", author: "九尾", summary: "古董店老板意外获得一本《山海经》残卷，发现书中异兽真实存在。他踏上寻找完整残卷的旅程，在现代都市与远古神话之间穿梭，揭开华夏文明的隐秘传承。", coverUrl: "", isImported: 2, fileType: "", currentChapterId: null, collected: 0 }
    ];
    for (let book of builtinBooks) {
      await db.reader_books.add(book);
    }
  }

  // 开始计时
  readerStartTime = Date.now();
  startReadingTimerInterval();

  await renderReaderTab();

  const tabs = document.querySelectorAll("#win-reader .chat-tabs .tab-item");
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      readerCurrentTab = tab.getAttribute("data-tab");

      const mainTitle = document.getElementById("reader-main-title");
      if (mainTitle) {
        if (readerCurrentTab === 'bookshelf') mainTitle.innerText = "书架";
        else if (readerCurrentTab === 'bookstore') mainTitle.innerText = "书城";
        else if (readerCurrentTab === 'mine') mainTitle.innerText = "我的";
      }

      renderReaderTab();
    };
  });
}

async function renderReaderTab() {
  document.querySelectorAll(".reader-tab-panel").forEach(p => p.classList.remove("active"));
  const targetPanel = document.getElementById(`reader-tab-${readerCurrentTab}`);
  if (targetPanel) {
    targetPanel.classList.add("active");
  }

  if (readerCurrentTab === 'bookshelf') {
    await renderBookshelf();
  } else if (readerCurrentTab === 'bookstore') {
    await renderBookstore();
  } else if (readerCurrentTab === 'mine') {
    await renderReaderMine();
  }
}

// 定时保存阅读时间片
function startReadingTimerInterval() {
  if (window.readerTimerId) clearInterval(window.readerTimerId);
  window.readerTimerId = setInterval(() => {
    if (document.getElementById("win-reader").classList.contains("active")) {
      const now = Date.now();
      const elapsed = Math.round((now - readerStartTime) / 1000);
      readerStartTime = now;
      
      const todayStr = new Date().toISOString().slice(0, 10);
      let todaySec = parseInt(localStorage.getItem(`reader_sec_${todayStr}`) || "0");
      todaySec += elapsed;
      localStorage.setItem(`reader_sec_${todayStr}`, todaySec.toString());
      
      let weekSec = parseInt(localStorage.getItem(`reader_sec_week`) || "0");
      weekSec += elapsed;
      localStorage.setItem(`reader_sec_week`, weekSec.toString());
    } else {
      readerStartTime = Date.now(); // 如果没开窗口，每次检查重新校对原点
    }
  }, 10000);
}

// ==========================================
//             2. 书架模块 (Bookshelf)
// ==========================================
async function renderBookshelf() {
  const grid = document.getElementById("bookshelf-grid-container");
  if (!grid) return;
  grid.innerHTML = "";

  const books = await db.reader_books.where('collected').equals(1).toArray();
  books.forEach(b => {
    const item = document.createElement("div");
    item.className = "bookshelf-item";
    item.onclick = () => openBookDetails(b.id);
    
    const coverHtml = b.coverUrl 
      ? `<img class="book-cover-img" src="${b.coverUrl}">`
      : `<div class="book-cover-title-fallback">${escapeHtml(b.title.slice(0, 8))}</div>`;

    // 限制书名最长显示 8 个字，防范撑大网格 [1]
    const displayTitle = b.title.length > 8 ? b.title.slice(0, 8) + "..." : b.title;

    item.innerHTML = `
      <div class="book-cover-wrapper">
        ${coverHtml}
      </div>
      <div class="book-meta-title">${escapeHtml(displayTitle)}</div>
    `;
    grid.appendChild(item);
  });

  // 最后一格放导入按钮
  const importItem = document.createElement("div");
  importItem.className = "bookshelf-item import-placeholder";
  importItem.onclick = () => {
    // 安全防护锁：防止用户在桌面双击启动应用时，第二下点击直接穿透击中书架的导入按钮 [1]
    if (Date.now() - (window.readerOpenTime || 0) < 350) return;
    document.getElementById("reader-file-importer").click();
  };
  importItem.innerHTML = `
    <div class="book-cover-wrapper">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </div>
    <div class="book-meta-title">本地导入</div>
  `;
  grid.appendChild(importItem);
}

// 自动识别编码自愈导入器
async function handleLocalFileImport(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  const fileName = file.name;
  const ext = fileName.split('.').pop().toLowerCase();
  
  if (!['txt', 'doc', 'docx', 'pdf'].includes(ext)) {
    showToast("系统提示：当前支持导入txt, doc, docx, pdf格式文件。");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const rawResult = e.target.result;
    
    // 乱码与编码自愈检测机制：若读取结果中包含了代表 UTF-8 解码失败的特有标志 \uFFFD (即 ），则判定编码为 GBK，强制进行无损二次重读 [1]
    if (rawResult.includes("\uFFFD") || rawResult.includes("")) {
      const gbkReader = new FileReader();
      gbkReader.onload = async (gbkEvent) => {
        await saveImportedBook(gbkEvent.target.result, fileName, ext);
      };
      gbkReader.readAsText(file, "GBK");
    } else {
      await saveImportedBook(rawResult, fileName, ext);
    }
    inputEl.value = "";
  };

  reader.readAsText(file, "UTF-8");
}

async function saveImportedBook(textContent, fileName, ext) {
  // 如果是 doc, docx, pdf 做文本解析降级，txt 直接读取
  if (ext !== 'txt') {
    textContent = `[本电子书为 ${ext.toUpperCase()} 文件导入，以下为提取的纯文本段落] \n\n` + textContent + "\n\n(系统提示：该非txt文件超过试读字数部分已精简，推荐导入纯txt文件以获得完整排版)";
  }

  const title = fileName.replace(`.${ext}`, "");
  const bookId = await db.reader_books.add({
    title,
    author: "本地导入",
    summary: "用户上传的本地电子书，文件格式为 " + ext.toUpperCase(),
    coverUrl: "",
    isImported: 1,
    fileType: ext,
    currentChapterId: 0,
    collected: 1
  });

  // 自动按「第n章 / 第n节 / Chapter n」等章节标题切分
  const chapters = splitTextIntoChapters(textContent);

  if (chapters.length > 1) {
    // 命中章节标题：按拆分结果批量入库
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      await db.reader_chapters.add({
        bookId,
        chapterNum: i + 1,
        title: c.title,
        content: c.content,
        summary: `【${c.title}】自动分段摘要，可点击下方摘要卡片编辑。`
      });
    }
    showToast(`成功导入电子书：${title}（共 ${chapters.length} 章）`);
  } else {
    // 未识别到章节标题：作为单章整体导入
    await db.reader_chapters.add({
      bookId,
      chapterNum: 1,
      title: "第一章",
      content: textContent,
      summary: "本地导入图书的初始文本部分。"
    });
    showToast("成功导入电子书：" + title);
  }

  await renderBookshelf();
}

/**
 * 智能章节切分器
 * 支持识别：
 *   - 第n章 / 第n节 / 第n回 / 第n卷 / 第n篇（汉字数字、阿拉伯数字、罗马数字均可）
 *   - Chapter n / Section n
 *   - 序章 / 楔子 / 引子 / 楔子 / 尾声 / 终章 / 后记 / 番外
 * 若识别到 ≥2 章，则按章节切分；否则返回单章兜底。
 */
function splitTextIntoChapters(rawText) {
  if (!rawText || !rawText.trim()) return [];

  // 统一换行符，便于后续按行扫描
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 章节标题正则（独占一行，前后可有少量空白与符号）
  // 支持：第一章 / 第1章 / 第123节 / 第十二回 / 序章 / 楔子 / 引子 / 尾声 / 终章 / 后记 / 番外 / Chapter 1 / Section 2
  const chapterRegex = /^[ \t]*【?第\s*([零一二三四五六七八九十百千万0-9]+)\s*[章节回卷篇部]\】?[ \t]*.*$/;
  const specialRegex = /^[ \t]*【?(序章|楔子|引子|前言|序言|序幕|尾声|终章|结尾|后记|番外篇?|外传|附章|附录)[】]?[ \t]*.*$/;
  const enRegex = /^[ \t]*(chapter|section|prologue|epilogue)\s+([0-9ivxlcdm]+)[ \t.*:：\-]*.*$/i;

  const lines = text.split("\n");
  const chapters = []; // { title, startLine }
  let preamble = ""; // 章节标题之前的导言/简介

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let matchedTitle = null;
    let m;
    if ((m = line.match(chapterRegex))) {
      matchedTitle = `第${m[1]}章`;
    } else if ((m = line.match(specialRegex))) {
      matchedTitle = m[1];
    } else if ((m = line.match(enRegex))) {
      matchedTitle = `${m[1]} ${m[2]}`;
    }

    if (matchedTitle) {
      // 使用原始行作为标题（保留可能附加的章节名，如「第一章 雨夜重逢」）
      const originalLine = lines[i].trim().replace(/^【+/, "").replace(/】+$/, "").trim();
      chapters.push({ title: originalLine.length > 40 ? matchedTitle : originalLine, startLine: i });
    } else if (chapters.length === 0) {
      // 还没遇到章节标题，累计为前言
      preamble += lines[i] + "\n";
    }
  }

  // 兜底：识别不到 2 章，整体作为单章返回
  if (chapters.length < 2) {
    return [{
      title: "第一章",
      content: rawText.trim()
    }];
  }

  // 按章节起始行切片正文
  const result = [];
  // 前言部分（若有内容）作为独立的「序言」章
  if (preamble.trim().length > 50) {
    result.push({
      title: "序言",
      content: preamble.trim()
    });
  }

  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].startLine;
    const end = (i + 1 < chapters.length) ? chapters[i + 1].startLine : lines.length;
    // 跳过标题行本身（保留在 title 字段），正文从下一行开始
    const content = lines.slice(start + 1, end).join("\n").trim();
    if (content) {
      result.push({
        title: chapters[i].title,
        content: content
      });
    }
  }

  // 若切完后只剩 1 章（前言+1 或单章），返回兜底单章
  if (result.length < 2) {
    return [{
      title: "第一章",
      content: rawText.trim()
    }];
  }

  return result;
}

// ==========================================
//             3. 书城模块 (Bookstore)
// ==========================================
async function renderBookstore() {
  // 关键修复：只有真正点击"刷新"按钮才调用 API。首次进入显示内置 10 本热门书籍。
  const container = document.getElementById("store-trending-container");
  if (!container || container.children.length === 0) {
    await renderBuiltinTrendingBoard();
  }
  // 刷新分类标签
  await refreshCategories();
}

// 渲染内置热门书籍榜单（不调API，直接从本地数据库取 isImported=2 的内置书籍）
async function renderBuiltinTrendingBoard() {
  const container = document.getElementById("store-trending-container");
  if (!container) return;
  container.innerHTML = "";
  const builtinBooks = await db.reader_books.where('isImported').equals(2).toArray();
  if (builtinBooks.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#94a3b8;">暂无榜单数据，点击右上角刷新获取在线推荐</div>`;
    return;
  }
  builtinBooks.forEach(b => {
    const card = createHorizontalBookCard({ title: b.title, author: b.author, summary: b.summary }, false);
    container.appendChild(card);
  });
}

async function refreshTrendingBoard() {
  const container = document.getElementById("store-trending-container");
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#94a3b8;">加载排行榜中...</div>`;

  // 榜单AI随机生成不依赖人设
  try {
    const api = await getActiveApiPreset();
    if (!api) {
      container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#ef4444;">请先配置全局大模型API</div>`;
      return;
    }

    const prompt = `你是一个小说风向标，请随机推荐2个在当前极为火热、符合大众潮流的小说。
请严格按照以下JSON格式返回：
[
  {"title": "书名", "author": "笔名", "summary": "200-300字精彩剧情大纲"}
]
绝对不允许附带任何 markdown 或 Emoji 代码！`;

    const res = await fetchAIResponse(api, prompt);
    const books = parseAIJsonList(res);
    
    container.innerHTML = "";
    books.forEach(b => {
      const card = createHorizontalBookCard(b, false);
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#ef4444;">榜单加载异常</div>`;
  }
}

async function refreshCategories() {
  const tagsGrid = document.getElementById("store-tags-grid");
  if (!tagsGrid) return;
  tagsGrid.innerHTML = "";

  const tags = await db.reader_tags.toArray();
  tags.forEach(t => {
    const tagEl = document.createElement("div");
    tagEl.className = "category-tag-item";
    tagEl.innerText = t.name;
    tagEl.onclick = () => triggerCategorySearch(t.name);
    
    // 长按编辑标签
    tagEl.oncontextmenu = (e) => {
      e.preventDefault();
      triggerTagEditDialog(t.id, t.name);
    };

    tagsGrid.appendChild(tagEl);
  });
}

async function triggerCategorySearch(tagName) {
  const container = document.getElementById("store-category-list-container");
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#94a3b8;">分类推演中...</div>`;

  try {
    const api = await getActiveApiPreset();
    const prompt = `你是一个分类小说大图景。请根据分类标签「${tagName}」，为我随机推演2本此分类下的小说。
请严格按照以下JSON格式返回：
[
  {"title": "书名", "author": "笔名", "summary": "200-300字精彩大纲"}
]
绝对不允许附带任何 markdown 或是 Emoji 代码！`;

    const res = await fetchAIResponse(api, prompt);
    const books = parseAIJsonList(res);
    
    container.innerHTML = "";
    books.forEach(b => {
      const card = createHorizontalBookCard(b, false);
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:12px;font-size:11px;color:#ef4444;">分类小说生成失败</div>`;
  }
}

function createHorizontalBookCard(b, isSearch) {
  const card = document.createElement("div");
  card.className = "book-card-horizontal";
  card.onclick = () => openBookDetailsFromData(b.title, b.author, b.summary);

  card.innerHTML = `
    <div class="book-card-cover">${escapeHtml(b.title.slice(0, 4))}</div>
    <div class="book-card-info">
      <div class="book-card-title">${escapeHtml(b.title)}</div>
      <div class="book-card-author">作者：${escapeHtml(b.author)}</div>
      <div class="book-card-summary">${escapeHtml(b.summary)}</div>
    </div>
  `;
  return card;
}

// 标签分类编辑/增加/删除弹窗
function triggerTagEditDialog(id, currentName) {
  showCustomConfirm("编辑标签", `您想要对分类标签「${currentName}」进行何种操作？`, 
    () => {
      showCustomPrompt("重命名分类标签", currentName, async (newVal) => {
        if (newVal.trim()) {
          await db.reader_tags.update(id, { name: newVal.trim() });
          await refreshCategories();
        }
      });
    },
    () => {
      showCustomConfirm("确认删除", `确定要删除标签「${currentName}」吗？`, async () => {
        await db.reader_tags.delete(id);
        await refreshCategories();
      });
    }
  );
}

// 标签管理弹窗：可删除已有标签或新建新标签
async function triggerAddTagDialog() {
  const tags = await db.reader_tags.toArray();
  const overlay = document.createElement("div");
  overlay.className = "chat-details-overlay";
  overlay.style.cssText = "display:flex; z-index:9999;";
  overlay.innerHTML = `
    <div class="chat-details-panel" style="max-width:380px; width:90%; max-height:80vh; overflow-y:auto; border-radius:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--border);">
        <span style="font-size:16px; font-weight:700;">标签管理</span>
        <button id="tag-mgr-close" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--text-secondary);">✕</button>
      </div>
      <div style="padding:16px 20px;">
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">点击标签右侧按钮可删除；下方可新建标签</div>
        <div id="tag-mgr-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
          ${tags.length === 0 ? '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:12px 0;">暂无标签</div>' : tags.map(t => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg-secondary); border-radius:8px;">
              <span style="font-size:13px; font-weight:600;">${escapeHtml(t.name)}</span>
              <button class="tag-del-btn" data-id="${t.id}" data-name="${escapeHtml(t.name)}" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer;">删除</button>
            </div>
          `).join("")}
        </div>
        <div style="border-top:1px solid var(--border); padding-top:14px;">
          <div style="font-size:13px; font-weight:700; margin-bottom:8px;">新建标签</div>
          <div style="display:flex; gap:8px;">
            <input id="tag-mgr-new-input" type="text" placeholder="输入标签名称" style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:8px; font-size:13px; background:var(--bg-primary); color:var(--text-primary);">
            <button id="tag-mgr-add-btn" style="background:var(--primary); color:#fff; border:none; border-radius:8px; padding:8px 16px; font-size:13px; cursor:pointer; font-weight:600;">添加</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector("#tag-mgr-close");
  closeBtn.onclick = () => { overlay.remove(); };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // 删除标签
  overlay.querySelectorAll(".tag-del-btn").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-id"));
      const name = btn.getAttribute("data-name");
      showCustomConfirm("确认删除", `确定要删除标签「${name}」吗？`, async () => {
        await db.reader_tags.delete(id);
        overlay.remove();
        await refreshCategories();
        // 刷新标签管理弹窗
        triggerAddTagDialog();
      });
    };
  });

  // 新建标签（带去重校验）
  const addBtn = overlay.querySelector("#tag-mgr-add-btn");
  const newInput = overlay.querySelector("#tag-mgr-new-input");
  const doAdd = async () => {
    const val = newInput.value.trim();
    if (!val) return;
    // 去重校验
    const existing = await db.reader_tags.where('name').equals(val).first();
    if (existing) {
      showToast("该标签已存在！");
      return;
    }
    await db.reader_tags.add({ name: val });
    overlay.remove();
    await refreshCategories();
    triggerAddTagDialog();
  };
  addBtn.onclick = doAdd;
  newInput.onkeydown = (e) => { if (e.key === "Enter") doAdd(); };
}

// ==========================================
//             4. 搜索组件舱 (Search)
// ==========================================
async function openReaderSearch() {
  const overlay = document.getElementById("reader-search-overlay");
  overlay.classList.add("active");

  // 1. 载入预设下拉菜单
  const presetSelect = document.getElementById("search-preset-select");
  presetSelect.innerHTML = '<option value="">-- 选择写书提示词预设 --</option>';
  const presets = await db.reader_presets.toArray();
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.innerText = p.name;
    presetSelect.appendChild(opt);
  });

  // 2. 载入主角选择器 (展示头像、真名、备注名)
  const charGrid = document.getElementById("search-char-select-grid");
  charGrid.innerHTML = "";

  const sessions = await db.sessions.toArray();
  for (let s of sessions) {
    const char = await db.archives.get(s.charId);
    if (!char) continue;
    
    const card = document.createElement("div");
    card.className = "reader-char-option-card";
    card.setAttribute("data-char-id", s.charId);
    card.onclick = () => {
      document.querySelectorAll(".reader-char-option-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    };

    const avatarUrl = resolveAvatar(s.customCharAvatar || char.avatar);
    card.innerHTML = `
      <img class="reader-char-option-avatar" src="${avatarUrl}">
      <div class="reader-char-option-names">
        <span class="reader-char-option-real">${escapeHtml(s.customCharName || char.name)}</span>
        <span class="reader-char-option-remark">${escapeHtml(char.remark || "无备注")}</span>
      </div>
    `;
    charGrid.appendChild(card);
  }
}

function closeReaderSearch() {
  document.getElementById("reader-search-overlay").classList.remove("active");
}

async function triggerReaderAIBookSearch() {
  const inputKeyword = document.getElementById("search-keyword-input").value.trim();
  const extraRequirement = document.getElementById("search-extra-requirement").value.trim();
  const presetId = document.getElementById("search-preset-select").value;
  
  const selectedCard = document.querySelector(".reader-char-option-card.selected");
  if (!selectedCard) {
    showCustomAlert("信息不足", "请先在下方列表中选择一位会话角色作为主角设定！");
    return;
  }
  
  const charId = Number(selectedCard.getAttribute("data-char-id"));
  const charArc = await db.archives.get(charId);

  const activeMeId = localStorage.getItem("active_me_id");
  const userArc = activeMeId ? await db.archives.get(Number(activeMeId)) : null;

  const btnSearch = document.getElementById("btn-trigger-reader-search");
  btnSearch.disabled = true;
  btnSearch.innerText = "检索推演中...";

  const resultsList = document.getElementById("search-results-list");
  resultsList.innerHTML = `<div style="text-align:center;padding:24px;font-size:12px;color:#94a3b8;">AI 正在读取角色背景设定并生成对应对局图书...</div>`;

  try {
    const api = await getActiveApiPreset();
    let promptPresetText = "";
    if (presetId) {
      const presetObj = await db.reader_presets.get(Number(presetId));
      if (presetObj) promptPresetText = presetObj.prompt;
    }

    const mainPrompt = `你是一个深层灵魂小说构筑机。请根据以下主角设定与限制，为我生成2本专属的定制小说。
【男/女主角1 (Char 人设)】：
姓名：${charArc?.name}
设定背景：${charArc?.persona}

【主角2 (User 扮演人设)】：
姓名：${userArc?.name || "用户"}
设定背景：${userArc?.persona || "普通体验者"}

【设定主题/关键词】：${inputKeyword || "未限定"}
【附加要求】：${extraRequirement || "无"}
【写作指导预设】：${promptPresetText || "无"}

请严格按照以下纯净的JSON数组格式返回（绝对不要添加任何 markdown 代码包裹，也不要有任何 Emoji 字符）：
[
  {"title": "书名", "author": "随机生成的笔名", "summary": "200-300字精彩剧情大纲，重点描写两位主角之间的命运交织"}
]`;

    const res = await fetchAIResponse(api, mainPrompt);
    const books = parseAIJsonList(res);

    resultsList.innerHTML = "";
    if (books.length === 0) {
      resultsList.innerHTML = `<div style="text-align:center;padding:24px;font-size:12px;color:#ef4444;">未能成功提炼数据，请重新检索！</div>`;
    } else {
      books.forEach(b => {
        const card = createHorizontalBookCard(b, true);
        resultsList.appendChild(card);
      });
    }
  } catch(e) {
    resultsList.innerHTML = `<div style="text-align:center;padding:24px;font-size:12px;color:#ef4444;">检索失败: ${e.message}</div>`;
  } finally {
    btnSearch.disabled = false;
    btnSearch.innerText = "开始检索定制图书";
  }
}

// ==========================================
//             5. 书籍详情页 (Details)
// ==========================================
let detailsTempBook = null;

function openBookDetailsFromData(title, author, summary) {
  detailsTempBook = { title, author, summary, collected: 0 };
  
  document.getElementById("detail-book-title").innerText = title;
  document.getElementById("detail-book-author").innerText = "作者：" + author;
  document.getElementById("detail-book-summary").innerText = summary;
  
  const btnCollect = document.getElementById("btn-detail-collect");
  btnCollect.innerText = "加入书架";
  btnCollect.disabled = false;

  document.getElementById("reader-details-overlay").classList.add("active");
}

async function openBookDetails(bookId) {
  const b = await db.reader_books.get(bookId);
  if (!b) return;
  
  detailsTempBook = b;
  
  document.getElementById("detail-book-title").innerText = b.title;
  document.getElementById("detail-book-author").innerText = "作者：" + b.author;
  document.getElementById("detail-book-summary").innerText = b.summary;

  const btnCollect = document.getElementById("btn-detail-collect");
  if (b.collected === 1) {
    btnCollect.innerText = "移除书架";
  } else {
    btnCollect.innerText = "加入书架";
  }
  btnCollect.disabled = false;

  document.getElementById("reader-details-overlay").classList.add("active");
}

function closeBookDetails() {
  document.getElementById("reader-details-overlay").classList.remove("active");
}

async function toggleCollectBook() {
  if (!detailsTempBook) return;

  const btnCollect = document.getElementById("btn-detail-collect");

  if (detailsTempBook.collected === 1) {
    // 双向自愈：执行物理移除收藏 [1]
    await db.reader_books.update(detailsTempBook.id, { collected: 0 });
    detailsTempBook.collected = 0;
    showToast(`已从书架移除「${detailsTempBook.title}」`);
    btnCollect.innerText = "加入书架";
  } else {
    // 增加/补回收藏
    let bookId = detailsTempBook.id;
    if (bookId) {
      await db.reader_books.update(bookId, { collected: 1 });
    } else {
      bookId = await db.reader_books.add({
        title: detailsTempBook.title,
        author: detailsTempBook.author,
        summary: detailsTempBook.summary,
        coverUrl: "",
        isImported: 0,
        collected: 1
      });
    }
    detailsTempBook.id = bookId;
    detailsTempBook.collected = 1;
    showToast(`已将「${detailsTempBook.title}」加入书架！`);
    btnCollect.innerText = "移除书架";
  }
  await renderBookshelf();
}

// 兼容老调用映射
window.collectTempBookToShelf = toggleCollectBook;

// ==========================================
//             6. 主流阅读房间 (Reading Room)
// ==========================================
async function startReadingRoom() {
  if (!detailsTempBook) return;

  // 1. 如果是临时未收藏书籍，先强制建档入库，保障阅读进度索引完整
  let bookId = detailsTempBook.id;
  if (!bookId) {
    bookId = await db.reader_books.add({
      title: detailsTempBook.title,
      author: detailsTempBook.author,
      summary: detailsTempBook.summary,
      coverUrl: "",
      isImported: 0,
      collected: 1
    });
    await renderBookshelf();
  }

  currentReadingBookId = bookId;
  currentReadingBookObj = await db.reader_books.get(bookId);
  currentReadingChapterNum = 1;

  closeBookDetails();
  closeReaderSearch();

  document.getElementById("reading-room-title").innerText = currentReadingBookObj.title;
  document.getElementById("win-reading-room").classList.add("active");

  // 载入历史阅读偏好
  applyReadingPreferences();

  // 载入第一章
  await loadChapter(currentReadingChapterNum);
}

function exitReadingRoom() {
  document.getElementById("win-reading-room").classList.remove("active");
  // 重置伴读挂载
  isCompanionEnabled = false;
  companionCharId = null;
  document.getElementById("btn-companion-toggle-indicator").style.color = "#64748b";
}

async function loadChapter(chapterNum) {
  const container = document.getElementById("reading-content-container");
  container.innerHTML = `<div style="text-align:center;padding:100px 0;font-size:14px;color:#94a3b8;">正在加载本章对决正文...</div>`;
  container.scrollTop = 0;

  let chap = await db.reader_chapters
    .where('[bookId+chapterNum]')
    .equals([currentReadingBookId, chapterNum])
    .first();

  if (!chap) {
    if (currentReadingBookObj.isImported === 1) {
      // 导入书：仅允许在「最后一章 + 1」的位置触发 AI 续写
      const lastChapterNum = await getLastChapterNum(currentReadingBookId);
      if (chapterNum === lastChapterNum + 1) {
        await generateChapterViaAI(chapterNum, "");
        return;
      }
      container.innerHTML = `<div style="text-align:center;padding:100px 0;font-size:14px;color:#94a3b8;">本章未导入，且不在可续写范围内。<br>仅最后一章之后方可续写。</div>`;
      return;
    }
    // 线上定制小说：自动调用API生成新一章
    await generateChapterViaAI(chapterNum, "");
    return;
  }

  renderChapterDOM(chap);
}

// 获取当前书最后一章的 chapterNum（无章节返回 0）
async function getLastChapterNum(bookId) {
  const all = await db.reader_chapters.where('bookId').equals(bookId).toArray();
  if (!all || all.length === 0) return 0;
  return Math.max(...all.map(c => c.chapterNum || 0));
}

async function generateChapterViaAI(chapterNum, userRequirement) {
  const container = document.getElementById("reading-content-container");
  container.innerHTML = `<div style="text-align:center;padding:100px 0;font-size:14px;color:#cbd5e1;">AI 正在深度推演第 ${chapterNum} 章剧情对白...</div>`;

  try {
    const api = await getActiveApiPreset();

    // 获取前一章的摘要与正文末尾段落（作为「接续点」严格约束 AI 不复读）
    let prevSummary = "这是开篇第一章，无前置摘要。";
    let prevTail = ""; // 上一章最后 1-2 段的最后一个情节，作为续写起点
    let prevTitle = "";
    if (chapterNum > 1) {
      const prevChap = await db.reader_chapters
        .where('[bookId+chapterNum]')
        .equals([currentReadingBookId, chapterNum - 1])
        .first();
      if (prevChap) {
        prevSummary = prevChap.summary || "（上一章未提供摘要）";
        prevTitle = prevChap.title || `第 ${chapterNum - 1} 章`;
        // 取上一章正文最后 ~300 字作为接续锚点，明确告诉 AI 从这里「之后」开始写
        const prevContent = (prevChap.content || "").trim();
        if (prevContent) {
          prevTail = prevContent.slice(-300);
        }
      }
    }

    // 标题：导入书续写时保留原章节命名风格
    let chapterTitle = `第 ${chapterNum} 章`;
    if (currentReadingBookObj.isImported === 1 && prevTitle) {
      // 尝试沿用上一章命名风格（如「第三章 雨夜」）
      const m = prevTitle.match(/^(第[零一二三四五六七八九十百千万0-9]+[章节回卷篇部])(.*)$/);
      if (m) {
        // 简单的汉字数字递增：仅在能解析出阿拉伯/汉字数字时尝试
        chapterTitle = `第 ${chapterNum} 章`;
      }
    }

    // 强约束续写提示词：明确「直接接续上一章最后一个情节往后发展」「严禁复读上一章内容」
    const isContinuation = chapterNum > 1;
    const continuationClause = isContinuation
      ? `【续写铁律（最高优先级，违反即失败）】
1. 本章必须【直接接续】上一章「${prevTitle}」的最后一个情节往下发展，时间线、场景、人物状态无缝衔接。
2. 严禁复读、改写、复述、概述上一章的任何内容（包括对话、动作、场景描写、心理活动）。
3. 严禁把上一章末尾的桥段重新写一遍作为本章开头；本章开头必须是【上一章最后一个情节之后】的新进展。
4. 严格以上一章摘要为准推进剧情，不得自行偏离或重置已经发生的事件。
5. 若本章涉及新场景或时间跳跃，须有明确的过渡交代，不得凭空重置。

【上一章摘要（须严格遵循，不得与之矛盾）】：
${prevSummary}

【上一章正文最后一段（仅作为接续锚点，禁止复写）】：
${prevTail || "（无原文末段，请严格依据上一章摘要续写）"}`
      : `【前置剧情提要】：
${prevSummary}`;

    const prompt = `你是一个资深的小说大师。请根据以下大纲与要求，为我撰写第 ${chapterNum} 章的精彩正文内容。
【书名】：${currentReadingBookObj.title}
【小说大纲】：${currentReadingBookObj.summary}

${continuationClause}

【本章情节指导要求（在遵循续写铁律前提下优先展示）】：${userRequirement || "无特别要求，让剧情自然推进"}

请你直接输出本章的正文文字，正文必须在 1500 字以上。
【特别要求】：
1. 绝对不要包含任何 Emoji 字符。
2. 在正文的所有内容输出完毕后，空一行，在最底部独占一行输出本章的【剧情摘要】。
格式如下：
[SUMMARY]这里输入150字左右的本章情节摘要提要

【输出示例】：
（直接从新情节开始，不复读上一章）
正文内容...
正文结束...

[SUMMARY]本章写了……（新发生的事，不重复上一章）`;

    const res = await fetchAIResponse(api, prompt);

    let content = res;
    let summary = "本章未成功提炼摘要。";

    const summaryMatch = res.match(/\[SUMMARY\]([\s\S]*?)$/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      content = res.replace(/\[SUMMARY\][\s\S]*?$/i, "").trim();
    }

    // 写入数据库
    const chapId = await db.reader_chapters.add({
      bookId: currentReadingBookId,
      chapterNum,
      title: chapterTitle,
      content: content.trim(),
      summary: summary.trim()
    });

    await db.reader_books.update(currentReadingBookId, { currentChapterId: chapId });

    // 重绘
    await loadChapter(chapterNum);

  } catch(e) {
    container.innerHTML = `
      <div style="text-align:center;padding:80px 16px;font-size:14px;color:#ef4444;">
        章节生成失败: ${e.message}<br><br>
        <button class="btn btn-primary" onclick="loadChapter(${chapterNum})" style="margin-top:10px;">点击重新生成</button>
      </div>
    `;
  }
}

function renderChapterDOM(chap) {
  const container = document.getElementById("reading-content-container");
  container.innerHTML = "";

  const titleEl = document.createElement("h2");
  titleEl.style.cssText = "font-size: 20px; font-weight: 700; margin-bottom: 24px; text-align: left;";
  titleEl.innerText = chap.title;
  container.appendChild(titleEl);

  const paragraphs = chap.content.split(/\n+/);
  paragraphs.forEach((p, idx) => {
    const text = p.trim();
    if (!text) return;

    const pEl = document.createElement("p");
    pEl.className = "read-para";
    pEl.setAttribute("data-para-idx", idx);
    pEl.innerText = text;

    // 伴读双击触发
    pEl.ondblclick = (e) => {
      e.preventDefault();
      triggerCompanionReview(pEl, text, idx);
    };

    container.appendChild(pEl);
  });

  // 渲染摘要展示卡
  const summaryBox = document.createElement("div");
  summaryBox.className = "chapter-summary-card-box";
  summaryBox.innerHTML = `
    <div class="chapter-summary-card-title">💡 本章 AI 剧情摘要 (可编辑)</div>
    <div class="chapter-summary-card-content" id="chapter-summary-text-val" onclick="editChapterSummary(${chap.id})">${escapeHtml(chap.summary)}</div>
  `;
  container.appendChild(summaryBox);

  // 下方控制行 (重新生成、下一章)
  // - 线上定制小说：所有章节均允许重新生成与续写下一章
  // - 本地导入书：仅「最后一章」展示「续写下一章」按钮，中间章节不允许续写
  if (currentReadingBookObj.isImported !== 1) {
    const controlRow = document.createElement("div");
    controlRow.style.cssText = "display: flex; gap: 10px; margin-top: 24px; margin-bottom: 40px;";
    controlRow.innerHTML = `
      <button class="btn btn-outline" style="flex: 1; padding: 10px; font-size: 12px; border-radius: 8px;" onclick="promptRegenerateCurrentChapter(${chap.chapterNum})">重新生成本章</button>
      <button class="btn btn-primary" style="flex: 1; padding: 10px; font-size: 12px; border-radius: 8px; background-color:#0f766e; border:none;" onclick="promptGenerateNextChapter(${chap.chapterNum + 1})">生成下一章</button>
    `;
    container.appendChild(controlRow);
  } else {
    // 导入书：异步判断当前章是否为最后一章
    getLastChapterNum(currentReadingBookId).then(lastNum => {
      if (chap.chapterNum === lastNum) {
        const controlRow = document.createElement("div");
        controlRow.style.cssText = "display: flex; gap: 10px; margin-top: 24px; margin-bottom: 40px;";
        controlRow.innerHTML = `
          <button class="btn btn-primary" style="flex: 1; padding: 10px; font-size: 12px; border-radius: 8px; background-color:#0f766e; border:none;" onclick="promptGenerateNextChapter(${chap.chapterNum + 1})">续写下一章</button>
        `;
        container.appendChild(controlRow);
      } else {
        const tip = document.createElement("div");
        tip.style.cssText = "text-align:center; margin-top:24px; margin-bottom:40px; font-size:11px; color:#94a3b8;";
        tip.innerText = "本章为导入章节，仅最后一章之后方可续写。";
        container.appendChild(tip);
      }
    });
  }
}

// 编辑摘要
async function editChapterSummary(chapId) {
  const chap = await db.reader_chapters.get(chapId);
  if (!chap) return;

  showCustomPrompt("编辑本章剧情摘要", chap.summary, async (newVal) => {
    if (newVal.trim()) {
      await db.reader_chapters.update(chapId, { summary: newVal.trim() });
      const el = document.getElementById("chapter-summary-text-val");
      if (el) el.innerText = newVal.trim();
      showToast("摘要修改已保存！");
    }
  });
}

// 重新生成当前章节
function promptRegenerateCurrentChapter(chapterNum) {
  showCustomPrompt("请输入本章剧情指导大纲 (AI 优先参考)", "", async (requirement) => {
    // 先物理擦除本地当前章节记录，强迫冷启动重新生成
    await db.reader_chapters
      .where('[bookId+chapterNum]')
      .equals([currentReadingBookId, chapterNum])
      .delete();
    await generateChapterViaAI(chapterNum, requirement);
  });
}

// 生成下一章
function promptGenerateNextChapter(nextChapterNum) {
  showCustomPrompt("请输入下一章剧情剧情大纲 (AI 优先参考)", "", async (requirement) => {
    await generateChapterViaAI(nextChapterNum, requirement);
    currentReadingChapterNum = nextChapterNum;
  });
}

// ==========================================
//             7. 伴读评价系统 (Companion)
// ==========================================
// 全局缓存伴读高亮选择状态
window.tempCompanionCharId = null;

function openCompanionSelector() {
  const overlay = document.createElement("div");
  overlay.id = "companion-selector-overlay";
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "1500";
  
  // 载入当前的伴读选择作为初始高亮
  window.tempCompanionCharId = companionCharId;

  let html = `<div class="modal" style="max-width: 300px; padding: 16px;">
    <header class="modal-header" style="border-bottom:none; margin-bottom:12px;">
      <h4 style="font-weight:700;">选择伴读角色</h4>
    </header>
    <div class="reader-character-select-grid" style="max-height: 200px; margin-bottom: 16px;">`;

  db.sessions.toArray().then(async sessions => {
    for (let s of sessions) {
      const char = await db.archives.get(s.charId);
      if (!char) continue;
      
      const isSelectedClass = (companionCharId === s.charId) ? "selected" : "";

      html += `
        <div class="reader-char-option-card companion-opt-card ${isSelectedClass}" data-char-id="${s.charId}" onclick="readerSystem.selectCompanionToHighlight(this, ${s.charId})">
          <img class="reader-char-option-avatar" src="${resolveAvatar(s.customCharAvatar || char.avatar)}">
          <div class="reader-char-option-names">
            <span class="reader-char-option-real">${escapeHtml(s.customCharName || char.name)}</span>
            <span class="reader-char-option-remark">${escapeHtml(char.remark || "无备注")}</span>
          </div>
        </div>
      `;
    }

    html += `</div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-outline" style="flex:1;" onclick="document.getElementById('companion-selector-overlay').remove()">取消</button>
        <button class="btn btn-primary" style="flex:1; background-color:#0f766e; border:none;" onclick="readerSystem.saveCompanionSelection()">保存</button>
      </div>
    </div>`;

    overlay.innerHTML = html;
    document.getElementById("win-reader").appendChild(overlay); // 将挂载点由全局 phone-container 更改为 win-reader 应用视口内，从物理层级上解决叠加位移与泄漏异常 [1]
    
    // 异步执行完成后，必须添加 active 类名，以此物理激活 modal-overlay 的透明度与高抗干扰交互通道 [1]
    setTimeout(() => overlay.classList.add("active"), 10);
  });
}

function selectCompanionToHighlight(cardEl, charId) {
  const wasSelected = cardEl.classList.contains("selected");
  document.querySelectorAll(".companion-opt-card").forEach(c => c.classList.remove("selected"));
  if (!wasSelected) {
    cardEl.classList.add("selected");
    window.tempCompanionCharId = charId;
  } else {
    window.tempCompanionCharId = null;
  }
}

function saveCompanionSelection() {
  if (window.tempCompanionCharId) {
    isCompanionEnabled = true;
    companionCharId = window.tempCompanionCharId;
    document.getElementById("btn-companion-toggle-indicator").style.color = "#0f766e";
    showToast("伴读角色选择已应用！双击正文段落获取书评。");
  } else {
    isCompanionEnabled = false;
    companionCharId = null;
    document.getElementById("btn-companion-toggle-indicator").style.color = "#64748b";
    showToast("伴读角色已卸载。");
  }
  document.getElementById("companion-selector-overlay").remove();
}

// 伴读系统卸载
function disableCompanionSystem() {
  isCompanionEnabled = false;
  companionCharId = null;
  document.getElementById("btn-companion-toggle-indicator").style.color = "#64748b";
  showToast("伴读系统已关闭。");
}

async function triggerCompanionReview(pEl, paraText, paraIdx) {
  if (!isCompanionEnabled || !companionCharId) return;

  // 检查是否已经生成过书评气泡
  let commentBubble = pEl.querySelector(".para-comment-anchor");
  if (commentBubble) {
    commentBubble.remove();
  }

  const anchor = document.createElement("span");
  anchor.className = "para-comment-anchor";
  anchor.innerHTML = `
    <span class="para-comment-bubble-trigger" onclick="toggleCommentBalloon(this, event)">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </span>
  `;
  pEl.appendChild(anchor);

  const char = await db.archives.get(companionCharId);
  const sess = await db.sessions.where('charId').equals(companionCharId).first();

  const activeMeId = localStorage.getItem("active_me_id");
  const userArc = activeMeId ? await db.archives.get(Number(activeMeId)) : null;
  const userName = userArc ? userArc.name : "用户";
  const userPersona = userArc ? userArc.persona : "普通人背景设定";

  try {
    const api = await getActiveApiPreset();
    const prompt = `【伴读核心情境指令】
你是 [${char.name}]。此时此刻，你和 [${userName}] 正在共同阅读一本书。
你的伴读伙伴 [${userName}] 刚刚向你分享了书中的一段文字。请你根据你自身的性格设定、态度、情感以及对 [${userName}] 的羁绊关系，写出对这段文字的一句短小点评。

【你们双方的人设档案】：
你的扮演设定（${char.name}）：
${sess?.customCharPersona || char.persona}

你的伴读伙伴设定（${userName}）：
${userPersona}

【当前所读书名】：${currentReadingBookObj.title}
【正文选中段落】：
“ ${paraText} ”

【伴读书评输出守则】：
1. 必须完全用你（[${char.name}]）的口吻与第一人称做出点评（如感到鄙意、赞赏、调侃、戏谑、吃惊或产生情感共鸣，且点评应当表现出你正在与 ${userName} 互动）。
2. 字数必须严控在 50 字以内。
3. 绝对不要出现任何 Emoji，不要有任何 Markdown 代码块或额外引言，直接输出对白书评内容本身。`;

    const res = await fetchAIResponse(api, prompt);

    // 缓存书评文本于 DOM 节点上
    anchor.setAttribute("data-comment-text", res.trim());
    anchor.setAttribute("data-char-name", char.name);
    anchor.setAttribute("data-char-avatar", resolveAvatar(sess?.customCharAvatar || char.avatar));

  } catch(e) {
    anchor.setAttribute("data-comment-text", "伴读评阅超时。");
    anchor.setAttribute("data-char-name", char.name);
    anchor.setAttribute("data-char-avatar", resolveAvatar(sess?.customCharAvatar || char.avatar));
  }
}

window.toggleCommentBalloon = function(triggerEl, event) {
  event.stopPropagation();
  const anchor = triggerEl.parentNode;
  const pEl = anchor.parentNode;
  
  // 检查是否已经展示了书评气泡气球
  let existingBalloon = pEl.nextSibling;
  if (existingBalloon && existingBalloon.className === "para-comment-balloon") {
    existingBalloon.remove();
    return;
  }

  const commentText = anchor.getAttribute("data-comment-text") || "正在审阅段落中...";
  const charName = anchor.getAttribute("data-char-name") || "伙伴";
  const avatar = anchor.getAttribute("data-char-avatar") || "";

  const balloon = document.createElement("div");
  balloon.className = "para-comment-balloon";
  balloon.innerHTML = `
    <div class="para-comment-balloon-header">
      <img src="${avatar}" style="width:18px; height:18px; border-radius:50%; object-fit:cover;">
      <span>${escapeHtml(charName)} 的短评</span>
    </div>
    <div style="font-style:italic;">“ ${escapeHtml(commentText)} ”</div>
  `;

  // 插入到段落下方
  pEl.parentNode.insertBefore(balloon, pEl.nextSibling);
};

// ==========================================
//             8. 阅读设置面板 (Settings)
// ==========================================
function toggleReadingMenuBar(event) {
  if (event) {
    // 防止点击书评气泡、按钮、或者伴读触发器时误唤醒设置栏，彻底释放正文文字的所有点击响应区间 [1]
    if (event.target.closest(".para-comment-balloon") || event.target.closest("button") || event.target.closest(".para-comment-bubble-trigger")) {
      return;
    }
  }

  const menu = document.getElementById("reading-menu-bar");
  menu.classList.toggle("active");
}

function applyReadingPreferences() {
  const prefs = JSON.parse(localStorage.getItem("reader_preferences") || "{}");
  const bgTheme = prefs.bgTheme || "light_green";
  const textHex = prefs.textColor || "";

  const flowBody = document.getElementById("reading-content-container");
  
  // 1. 应用背景色主题类
  flowBody.className = "reading-flow-body";
  flowBody.classList.add(`read-theme-${bgTheme}`);
  
  // 2. 文本颜色
  if (textHex) {
    flowBody.style.color = textHex;
  } else {
    flowBody.style.color = "";
  }

  // 3. 统一规范上下滑动阅读空间排版
  flowBody.style.overflowX = "hidden";
  flowBody.style.overflowY = "auto";

  // 同步高亮设置点
  document.querySelectorAll(".theme-color-dot").forEach(dot => {
    dot.classList.toggle("active", dot.getAttribute("data-theme") === bgTheme);
  });
}

function selectReadingThemeColor(themeName) {
  const prefs = JSON.parse(localStorage.getItem("reader_preferences") || "{}");
  prefs.bgTheme = themeName;
  prefs.textColor = ""; // 重置十六进制自定色
  localStorage.setItem("reader_preferences", JSON.stringify(prefs));
  applyReadingPreferences();
}

function selectReadingTextCustomColor() {
  showCustomPrompt("请输入文本自定义十六进制色值", "#1e293b", (val) => {
    if (val.trim()) {
      const prefs = JSON.parse(localStorage.getItem("reader_preferences") || "{}");
      prefs.textColor = val.trim();
      localStorage.setItem("reader_preferences", JSON.stringify(prefs));
      applyReadingPreferences();
    }
  });
}

function changeReadingFlipStyle(style) {
  const prefs = JSON.parse(localStorage.getItem("reader_preferences") || "{}");
  prefs.flipStyle = style;
  localStorage.setItem("reader_preferences", JSON.stringify(prefs));
  applyReadingPreferences();
  showToast("翻页方式已更改！");
}

// ==========================================
//             9. 目录管理 (Directory)
// ==========================================
async function openReadingDirectory() {
  const drawer = document.getElementById("reading-directory-drawer");
  const mask = document.getElementById("reading-directory-mask");
  drawer.classList.add("active");
  mask.classList.add("active");

  const listContainer = document.getElementById("reading-directory-list");
  listContainer.innerHTML = "";

  const chapters = await db.reader_chapters.where('bookId').equals(currentReadingBookId).toArray();
  chapters.sort((a,b) => a.chapterNum - b.chapterNum).forEach(chap => {
    const item = document.createElement("div");
    item.className = "menu-item";
    item.style.fontSize = "13px";
    item.innerText = chap.title;
    item.onclick = () => {
      currentReadingChapterNum = chap.chapterNum;
      loadChapter(chap.chapterNum);
      closeReadingDirectory();
      document.getElementById("reading-menu-bar").classList.remove("active");
    };
    listContainer.appendChild(item);
  });
}

function closeReadingDirectory() {
  document.getElementById("reading-directory-drawer").classList.remove("active");
  document.getElementById("reading-directory-mask").classList.remove("active");
}

// ==========================================
//             10. 我的页管理 (Mine)
// ==========================================
async function renderReaderMine() {
  // 同步我的最上方信息
  const meAvatar = document.getElementById("reader-mine-active-avatar");
  const meName = document.getElementById("reader-mine-active-name");
  const meRemark = document.getElementById("reader-mine-active-remark");

  const activeMeId = localStorage.getItem("active_me_id");
  if (activeMeId) {
    const user = await db.archives.get(Number(activeMeId));
    if (user) {
      if (meAvatar) meAvatar.src = resolveAvatar(user.avatar);
      if (meName) meName.innerText = user.name;
      if (meRemark) meRemark.innerText = user.remark || "默认身份";
    }
  }

  // 统计时长
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySec = parseInt(localStorage.getItem(`reader_sec_${todayStr}`) || "0");
  const weekSec = parseInt(localStorage.getItem(`reader_sec_week`) || "0");

  document.getElementById("reader-stat-today-val").innerText = formatReadingTime(todaySec);
  document.getElementById("reader-stat-week-val").innerText = formatReadingTime(weekSec);

  // 渲染预设列表
  await renderReaderPresetsList();
}

function formatReadingTime(totalSec) {
  if (totalSec < 60) return `${totalSec}秒`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}分${secs}秒`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}小时${remainMins}分`;
}

async function renderReaderPresetsList() {
  const container = document.getElementById("reader-presets-container");
  if (!container) return;
  container.innerHTML = "";

  const presets = await db.reader_presets.toArray();
  if (presets.length === 0) {
    container.innerHTML = `<p style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;">暂无提示词预设，请点击下方增加。</p>`;
    return;
  }

  presets.forEach(p => {
    const row = document.createElement("div");
    row.className = "menu-item";
    row.style.justifyContent = "space-between";
    row.innerHTML = `
      <div style="display:flex; flex-direction:column; text-align:left; flex:1; cursor:pointer;" onclick="editReaderPreset(${p.id})">
        <span style="font-size:13px; font-weight:700; color:#1e293b;">${escapeHtml(p.name)}</span>
        <span style="font-size:11px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">${escapeHtml(p.prompt)}</span>
      </div>
      <button class="btn btn-danger-outline" style="padding:4px 8px; font-size:10px; border-radius:6px;" onclick="deleteReaderPreset(${p.id})">删除</button>
    `;
    container.appendChild(row);
  });
}

function triggerAddReaderPresetDialog() {
  showCustomPrompt("请输入新写书提示词预设名称", "", async (name) => {
    if (!name.trim()) return;
    showCustomPrompt("请输入提示词正文", "要求剧情冲突激烈...", async (promptText) => {
      if (promptText.trim()) {
        await db.reader_presets.add({ name: name.trim(), prompt: promptText.trim() });
        await renderReaderPresetsList();
      }
    });
  });
}

async function editReaderPreset(id) {
  const p = await db.reader_presets.get(id);
  if (!p) return;

  showCustomPrompt("修改预设名称", p.name, async (newName) => {
    if (!newName.trim()) return;
    showCustomPrompt("修改预设提示词正文", p.prompt, async (newPrompt) => {
      if (newPrompt.trim()) {
        await db.reader_presets.update(id, { name: newName.trim(), prompt: newPrompt.trim() });
        await renderReaderPresetsList();
      }
    });
  });
}

async function deleteReaderPreset(id) {
  showCustomConfirm("确认删除", "确定要彻底删除该写书预设吗？", async () => {
    await db.reader_presets.delete(id);
    await renderReaderPresetsList();
  });
}

// ==========================================
//             10. 通用底层桥接器
// ==========================================
async function getActiveApiPreset() {
  const presetId = localStorage.getItem("global_api_preset_id");
  if (!presetId) throw new Error("未配置全局 API 预设，请前往系统设置配置！");
  return await db.api_presets.get(Number(presetId));
}

async function fetchAIResponse(api, promptText) {
  const response = await fetch(`${api.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
    body: JSON.stringify({
      model: api.model,
      messages: [{ role: "user", content: promptText }],
      temperature: api.temperature
    })
  });
  if (!response.ok) throw new Error("大模型交互响应失败");
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function parseAIJsonList(text) {
  // 提取 JSON 块
  const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch(e) {}
  }
  
  // 降级文本分行正则提取
  const books = [];
  const lines = text.split(/\n+/);
  let currentBook = null;
  
  lines.forEach(line => {
    const cleaned = line.replace(/^[\s\d.、*-]+/, "").trim();
    if (cleaned.startsWith("书名") || cleaned.startsWith("title")) {
      if (currentBook) books.push(currentBook);
      currentBook = { title: cleaned.split(/[:：]/).slice(1).join(":").trim(), author: "风流客", summary: "剧情介绍中..." };
    } else if (cleaned.startsWith("作者") || cleaned.startsWith("author")) {
      if (currentBook) currentBook.author = cleaned.split(/[:：]/).slice(1).join(":").trim();
    } else if (cleaned.startsWith("简介") || cleaned.startsWith("summary")) {
      if (currentBook) currentBook.summary = cleaned.split(/[:：]/).slice(1).join(":").trim();
    }
  });
  if (currentBook) books.push(currentBook);
  return books.slice(0, 3);
}

// 暴露出接口至全局
window.readerSystem = {
  init: initReaderApp,
  handleLocalFileImport,
  openReaderSearch,
  closeReaderSearch,
  triggerReaderAIBookSearch,
  collectTempBookToShelf,
  closeBookDetails,
  startReadingRoom,
  exitReadingRoom,
  toggleReadingMenuBar,
  selectReadingThemeColor,
  selectReadingTextCustomColor,
  changeReadingFlipStyle,
  openReadingDirectory,
  closeReadingDirectory,
  openCompanionSelector,
  triggerAddReaderPresetDialog,
  triggerAddTagDialog,
  refreshTrendingBoard,
  selectCompanionToHighlight,
  saveCompanionSelection
};