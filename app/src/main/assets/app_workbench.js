/**
 * app_workbench.js - 工作台 Agent（多对话 + 本地工作区 + GitHub + 多轮工具调用）
 *
 * 对标市面 Agent 手机端（Claude / Trae）：
 * - 多对话窗口：会话列表 + 对话页，可自由新建/删除/重命名
 * - 每对话专属本地工作区（Kotlin WorkbenchFileSystem 桥接，App 私有目录，免权限）
 * - 可选连接 GitHub：用户自配 用户名 + Token，通过 Contents API 推送文件
 * - 多轮工具循环：[`WB_TOOL: {...}`] 协议，支持 文件读写 / 目录 / GitHub 推送 / 网页抓取 / MCP
 * - 上下文裁剪 + 对话摘要 + 输入/输出 Token 统计 + 缓存命中统计
 *
 * 界面约束：无任何 emoji；全部按钮使用 SVG 通用路径图标；全部弹窗为自制卡片（禁用原生 alert/confirm/prompt）。
 */
(function () {
  "use strict";

  var WB = {
    // ==================== 常量 ====================
    MAX_TOOL_LOOPS: 8,          // 单轮用户消息最多工具循环次数
    MAX_CONTEXT_TOKENS: 8000,   // 上下文 token 预算（超出则折叠旧消息）
    TOOL_TAG: "WB_TOOL",

    state: {
      view: "list",             // list | chat
      activeConvId: null,
      sending: false,
      abortCtrl: null,
      inputTimer: null,
    },

    // ==================== 工具：文件系统（Kotlin 桥） ====================
    fs: {
      _guard: function () {
        if (window.AndroidMCP && typeof window.AndroidMCP.wbListDir === "function") return true;
        return false;
      },
      listDir: function (path) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统（请安装 APK 使用）" };
        try { return JSON.parse(window.AndroidMCP.wbListDir(path || ".")); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      readFile: function (path) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbReadFile(path)); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      writeFile: function (path, content) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbWriteFile(path, content)); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      mkdir: function (path) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbMkdir(path)); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      del: function (path) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbDelete(path)); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      roots: function () {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbGetRoots()); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      },
      listPublic: function (path) {
        if (!this._guard()) return { ok: false, error: "当前环境不支持原生文件系统" };
        try { return JSON.parse(window.AndroidMCP.wbListPublicDir(path)); } catch (e) { return { ok: false, error: "解析失败: " + e.message }; }
      }
    },

    // ==================== 工具：GitHub（Contents API） ====================
    github: {
      config: function () {
        try { return JSON.parse(localStorage.getItem("wb_github_config")) || null; } catch (e) { return null; }
      },
      saveConfig: function (cfg) {
        localStorage.setItem("wb_github_config", JSON.stringify(cfg || null));
      },
      clearConfig: function () {
        localStorage.removeItem("wb_github_config");
      },
      headers: function () {
        var cfg = this.config();
        if (!cfg || !cfg.token) return null;
        return {
          "Authorization": "Bearer " + cfg.token,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        };
      },
      /** 推送文件到 GitHub（Contents API，支持创建与更新） */
      pushFile: async function (opts) {
        var cfg = this.config();
        if (!cfg || !cfg.token || !cfg.username) return { ok: false, error: "尚未配置 GitHub（用户名/Token），请先在工作台设置中连接" };
        var owner = (opts.owner || cfg.username).trim();
        var repo = (opts.repo || cfg.repo || "").trim();
        if (!repo) return { ok: false, error: "未指定 GitHub 仓库（repo）" };
        var filePath = String(opts.path || "").trim();
        if (!filePath) return { ok: false, error: "未指定推送路径（path）" };
        var message = String(opts.message || "workbench update").trim();
        var content = String(opts.content || "");
        var branch = String(opts.branch || "main").trim();
        var headers = this.headers();
        try {
          // 1. 查询文件是否存在（拿 sha）
          var existingSha = null;
          var getRes = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + filePath + "?ref=" + encodeURIComponent(branch), { headers: headers });
          if (getRes.status === 200) {
            var exist = await getRes.json();
            existingSha = exist.sha || null;
          } else if (getRes.status !== 404) {
            return { ok: false, error: "查询文件失败: HTTP " + getRes.status };
          }
          // 2. 创建 / 更新
          var payload = {
            message: message,
            content: btoa(unescape(encodeURIComponent(content))),
            branch: branch
          };
          if (existingSha) payload.sha = existingSha;
          var putRes = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + filePath, {
            method: "PUT",
            headers: Object.assign({ "Content-Type": "application/json" }, headers),
            body: JSON.stringify(payload)
          });
          if (putRes.status === 200 || putRes.status === 201) {
            var data = await putRes.json();
            return { ok: true, message: "已推送 " + filePath + " 到 " + owner + "/" + repo + " (" + branch + ")", commit: (data.commit && data.commit.sha) || "" };
          }
          var errText = await putRes.text();
          return { ok: false, error: "推送失败: HTTP " + putRes.status + " " + errText.slice(0, 300) };
        } catch (e) {
          return { ok: false, error: "GitHub 请求异常: " + e.message };
        }
      }
    },

    // ==================== 数据层（IndexedDB：db.wb_conversations / db.wb_messages） ====================
    convs: async function () {
      try { return (await db.wb_conversations.orderBy("updatedAt").reverse().toArray()) || []; } catch (e) { return []; }
    },
    getConv: async function (id) {
      try { return await db.wb_conversations.get(Number(id)); } catch (e) { return null; }
    },
    addConv: async function (data) {
      return await db.wb_conversations.add(Object.assign({
        title: "未命名会话",
        workspace: ".",
        workspaceLabel: "工作台私有区",
        github: null,
        systemPrompt: "",
        summary: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalTokensIn: 0,
        totalTokensOut: 0,
        cacheHits: 0
      }, data || {}));
    },
    updateConv: async function (id, patch) {
      try { await db.wb_conversations.update(Number(id), Object.assign({ updatedAt: Date.now() }, patch)); } catch (e) {}
    },
    delConv: async function (id) {
      try { await db.wb_conversations.delete(Number(id)); } catch (e) {}
      try { await db.wb_messages.where("convId").equals(Number(id)).delete(); } catch (e) {}
    },
    msgs: async function (convId) {
      try { return (await db.wb_messages.where("convId").equals(Number(convId)).sortBy("seq")) || []; } catch (e) { return []; }
    },
    addMsg: async function (m) {
      try { return await db.wb_messages.add(m); } catch (e) { return null; }
    },
    lastMsg: async function (convId) {
      try { return (await db.wb_messages.where("convId").equals(Number(convId)).sortBy("seq")).pop() || null; } catch (e) { return null; }
    },

    // ==================== 网页读取：原始抓取 + 正文抽取 ====================
    // 背景：早期 fetch_url 直接返回原始 HTML 的前 8000 字符，而真实页面这 8000 字符
    // 几乎全在 <head>（meta/内联样式/脚本）里，正文根本没截到 → 模型只看到 meta 标签。
    // 现在改为：拿到完整 HTML 后做「正文抽取」（保留标题/小标题/列表/链接/表格结构），
    // 再交给模型；同时对 JS 动态渲染页面给出显式标记与建议。
    _UA: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",

    /** 原始抓取（多通道自适应）：原生桥 → 直连 → cors-proxy:3001 → link-meta:3003/raw → mcpFetch(含公共代理) */
    rawFetch: async function (url, method, headers, body) {
      var self = this;
      var hdrs = Object.assign({
        "User-Agent": self._UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      }, headers || {});
      var errors = [];
      var pickCtype = function (h) {
        var out = "";
        if (!h) return out;
        if (typeof h.get === "function") { try { return String(h.get("content-type") || ""); } catch (e) { return ""; } }
        Object.keys(h).forEach(function (k) { if (k.toLowerCase() === "content-type") out = String(h[k] || ""); });
        return out;
      };

      // 1) APK 原生桥（完全绕过 WebView CORS）
      if (window.AndroidMCP && typeof window.AndroidMCP.sendNativeHttpRequest === "function") {
        try {
          var nativeRes = window.AndroidMCP.sendNativeHttpRequest(url, method, JSON.stringify(hdrs), body || "");
          if (nativeRes) {
            var pr = JSON.parse(nativeRes);
            if (pr && typeof pr.body === "string" && (pr.status > 0)) {
              return { ok: pr.status >= 200 && pr.status < 300, status: pr.status, text: pr.body, contentType: pickCtype(pr.headers), via: "native" };
            }
          }
        } catch (e) { errors.push("native: " + e.message); }
      }

      // 2) 浏览器直连
      try {
        var res = await fetch(url, { method: method, headers: hdrs, body: (body && method !== "GET") ? body : undefined });
        return { ok: res.ok, status: res.status, text: await res.text(), contentType: pickCtype(res.headers), via: "direct" };
      } catch (e) { errors.push("direct: " + e.message); }

      // 3) 本地代理（Termux 服务）
      var localProxies = [
        { base: "http://127.0.0.1:3001/proxy?url=", via: "cors-proxy:3001" },
        { base: "http://127.0.0.1:3003/raw?url=", via: "link-meta:3003" }
      ];
      for (var i = 0; i < localProxies.length; i++) {
        try {
          var r2 = await fetch(localProxies[i].base + encodeURIComponent(url));
          if (r2 && r2.ok) return { ok: true, status: r2.status, text: await r2.text(), contentType: pickCtype(r2.headers), via: localProxies[i].via };
          errors.push(localProxies[i].via + ": HTTP " + (r2 && r2.status));
        } catch (e2) { errors.push(localProxies[i].via + ": " + e2.message); }
      }

      // 4) MCP 通用引擎（含公共代理容灾）
      try {
        if (window.mcpClientSystem && typeof window.mcpClientSystem.mcpFetch === "function") {
          var r3 = await window.mcpClientSystem.mcpFetch(url, { method: method, headers: hdrs, body: (body && method !== "GET") ? body : undefined });
          if (r3) return { ok: r3.ok !== false, status: r3.status || 200, text: await r3.text(), contentType: pickCtype(r3.headers), via: "mcpFetch" };
        }
      } catch (e3) { errors.push("mcpFetch: " + e3.message); }

      return { ok: false, error: "抓取失败（所有通道均不可用）: " + errors.join("；") };
    },

    /** HTML 实体解码 */
    _decodeEntities: function (s) {
      var map = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", "#34": "\"", "#x27": "'", "#x2F": "/", ldquo: "“", rdquo: "”", hellip: "…", mdash: "—", ndash: "–" };
      return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, code) {
        if (map[code] !== undefined) return map[code];
        if (code.charAt(0) === "#") {
          var num = code.charAt(1).toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
          if (!isNaN(num) && num > 0 && num < 1114112) { try { return String.fromCodePoint(num); } catch (e) { return m; } }
        }
        return m;
      });
    },

    /**
     * HTML → 可读正文（保留标题层级 / 列表 / 链接 / 表格）
     * 返回 { title, description, text, links[], embedded[], scriptCount, jsonLd[] }
     */
    htmlToText: function (html) {
      var raw = String(html || "");
      var out = { title: "", description: "", text: "", links: [], embedded: [], scriptCount: 0, jsonLd: [] };

      // 标题与描述（从 head 里取，作为补充信息而非正文）
      var tm = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (tm) out.title = this._decodeEntities(tm[1].replace(/\s+/g, " ")).trim();
      var dm = raw.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/i);
      if (dm) {
        var dc = dm[0].match(/content=["']([\s\S]*?)["']/i);
        if (dc) out.description = this._decodeEntities(dc[1]).replace(/\s+/g, " ").trim();
      }

      // JSON-LD
      var ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, lm;
      while ((lm = ldRe.exec(raw)) !== null) {
        var ldTxt = lm[1].trim();
        if (ldTxt) out.jsonLd.push(ldTxt.slice(0, 2000));
      }

      // 内嵌应用状态（SPA 常见：服务端把数据塞进 JSON 供前端渲染）
      var statePatterns = [
        /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
        /window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
        /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
        /window\.__INITIAL_DATA__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
        /window\.__APOLLO_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
        /window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
        /window\.__data\s*=\s*([\s\S]*?);?\s*<\/script>/i
      ];
      statePatterns.forEach(function (re) {
        var m = raw.match(re);
        if (m && m[1] && m[1].length > 40) out.embedded.push({ key: (re.source.match(/__([A-Za-z_]+)__|__data/) || ["embedded"])[0], json: m[1].trim() });
      });

      // 去噪：脚本/样式/注释/内联模板
      var body = raw
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<canvas[\s\S]*?<\/canvas>/gi, " ")
        .replace(/<template[\s\S]*?<\/template>/gi, " ")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");
      out.scriptCount = (raw.match(/<script/gi) || []).length;

      // 链接先抽取（随后正文里的 a 标签会被压成纯文本，链接单独列出更省 token）
      var aRe = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, am;
      while ((am = aRe.exec(body)) !== null && out.links.length < 60) {
        var lt = this._decodeEntities(am[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        if (!lt || lt.length > 80) continue;
        var href = am[1].trim();
        if (/^javascript:/i.test(href)) continue;
        out.links.push({ text: lt, href: href });
      }

      // 结构 → 文本
      var txt = body
        .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n")
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n")
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n")
        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n#### $1\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<tr\b[^>]*>/gi, "\n| ")
        .replace(/<\/t[dh]>/gi, " | ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|article|header|footer|nav|aside|ul|ol|table|main|figure|blockquote|dd|dt|pre)>/gi, "\n")
        .replace(/<[^>]+>/g, " ");
      txt = this._decodeEntities(txt)
        .replace(/\r/g, "")
        .replace(/[ \t\u00a0\u200b]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // 连续重复行折叠（SPA 骨架页常见「打开App查看更多」刷屏；允许中间夹空行）
      var lines = txt.split("\n"), kept = [], lastNonEmpty = null;
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        if (ln && ln === lastNonEmpty) continue;
        if (ln) lastNonEmpty = ln;
        kept.push(ln);
      }
      out.text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      return out;
    },

    /** 从内嵌 JSON 里「捞」出可读文本（SPA 的数据往往就在这里面，正文区只是骨架） */
    harvestStrings: function (jsonText, limit) {
      var found = [], seen = {};
      var re = /"((?:[^"\\]|\\.){10,400})"/g, m;
      while ((m = re.exec(String(jsonText || ""))) !== null && found.length < (limit || 60)) {
        var s = m[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\u([0-9a-fA-F]{4})/g, function (x, h) { return String.fromCharCode(parseInt(h, 16)); }).replace(/\\\//g, "/").replace(/\s+/g, " ").trim();
        if (s.length < 10) continue;
        if (/^https?:\/\//i.test(s)) continue;              // 纯 URL
        if (/^[0-9a-f]{16,}$/i.test(s)) continue;           // 哈希/ID
        if (/^[A-Za-z0-9_\-.:\/]+$/.test(s)) continue;      // 纯标识符（配置键/类名/路径）
        if (/^[\d\s\-:.,]+$/.test(s)) continue;             // 纯数字时间戳
        // 只保留「像人话」的：含中文，或足够长且带空格
        var hasCJK = /[\u4e00-\u9fa5]/.test(s);
        if (!hasCJK && !(s.length >= 24 && /\s/.test(s))) continue;
        if (seen[s]) continue;
        seen[s] = 1;
        found.push(s);
      }
      return found;
    },

    /** 统一抓取入口：按 mode 返回「正文 / 原始 HTML / JSON」 */
    fetchPage: async function (args) {
      var self = this;
      var url = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "仅支持 http/https 地址" };
      var method = String(args.method || "GET").toUpperCase();
      var mode = String(args.mode || "auto").toLowerCase();
      var maxChars = parseInt(args.max_chars, 10);
      if (isNaN(maxChars) || maxChars <= 0) maxChars = 10000;
      maxChars = Math.min(Math.max(maxChars, 500), 20000);

      var r = await self.rawFetch(url, method, args.headers, args.body);
      if (!r || (r.ok === false && !r.text)) return { ok: false, error: (r && r.error) || "抓取失败" };
      var text = String(r.text || "");
      var ctype = String(r.contentType || "");
      // JSON 判定：优先看 Content-Type；拿不到时按内容形状兜底（很多接口/代理不带头）
      var looksJson = /json/i.test(ctype) || (!ctype && /^\s*[\[{]/.test(text) && /"[^"]{1,60}"\s*:/.test(text.slice(0, 3000)));
      if (mode === "json") looksJson = true;

      // JSON 接口：直接结构化返回（很多站点的"搜索结果"其实是 XHR 接口）
      if (looksJson) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {}
        if (parsed !== null) {
          var pretty = JSON.stringify(parsed, null, 2);
          var truncatedJson = pretty.length > maxChars;
          return {
            ok: true, status: r.status, url: url, via: r.via, contentType: ctype || "application/json", mode: "json",
            text: truncatedJson ? pretty.slice(0, maxChars) + "\n…（已截断，共 " + pretty.length + " 字符；可调小 max_chars 或改用更精确的接口）" : pretty,
            truncated: truncatedJson
          };
        }
      }

      if (mode === "html") {
        var cut = text.length > maxChars;
        return { ok: true, status: r.status, url: url, via: r.via, contentType: ctype || "text/html", mode: "html", text: cut ? text.slice(0, maxChars) + "\n…（已截断）" : text, truncated: cut };
      }

      // 默认：抽取可读正文
      var ex = self.htmlToText(text);
      var bodyText = ex.text || "";
      var dense = bodyText.replace(/\s+/g, "").length;
      var jsRendered = ex.scriptCount >= 3 && dense < 300;
      var truncated = bodyText.length > maxChars;
      var result = {
        ok: true, status: r.status, url: url, via: r.via,
        contentType: ctype || "text/html", mode: "text",
        title: ex.title, description: ex.description,
        text: truncated ? bodyText.slice(0, maxChars) + "\n…（正文已截断，共 " + bodyText.length + " 字符）" : bodyText,
        chars: bodyText.length, truncated: truncated,
        jsRendered: jsRendered
      };
      if (ex.links.length) result.links = ex.links.slice(0, 30);
      if (ex.jsonLd.length) result.jsonLd = ex.jsonLd.slice(0, 2);
      if (ex.embedded.length) {
        // 内嵌状态往往是 SPA 的真实数据源：挑最长的那个给出（截断），并把里面的可读文本捞出来
        var biggest = ex.embedded[0];
        ex.embedded.forEach(function (b) { if (b.json.length > biggest.json.length) biggest = b; });
        result.embeddedJson = { key: biggest.key, preview: biggest.json.slice(0, 4000) + (biggest.json.length > 4000 ? "\n…（截断，原始 " + biggest.json.length + " 字符）" : "") };
        result.embeddedKeys = ex.embedded.map(function (b) { return b.key; });
        var harvested = self.harvestStrings(biggest.json, 60);
        if (harvested.length) {
          var joined = harvested.join("\n");
          result.embeddedText = joined.length > 3000 ? joined.slice(0, 3000) + "\n…（已截断）" : joined;
          // 内嵌数据有实质内容、而正文区只是骨架 → 判定为 JS 渲染页
          if (dense < 1500 && harvested.length >= 5) jsRendered = true;
          result.jsRendered = jsRendered;
        }
      }
      if (jsRendered) {
        result.hint = "该页面正文疑似由 JS 动态渲染：服务端返回的 HTML 里正文区只是骨架。" +
          (result.embeddedText ? "已从页面内嵌状态（" + (result.embeddedKeys || []).join("/") + "）中捞出可读文本，见 embeddedText / embeddedJson。" : "") +
          " 若仍拿不到需要的数据，改用该站点的数据接口（浏览器开发者工具 Network → Fetch/XHR 找真实数据 URL，再用 fetch_url + mode:\"json\" 请求）。";
      } else if (dense < 300 && ex.scriptCount >= 3) {
        result.hint = "正文抽取结果很短，可能被反爬拦截（需登录/验证码）或页面结构特殊；可尝试 mode:\"html\" 看原始 HTML，或改用站点接口。";
      }
      return result;
    },

    // ==================== 工具集（供 Agent 调用） ====================
    tools: {
      list_dir: function (args, conv) {
        var p = WB.fsPath(args.path, conv);
        return WB.fs.listDir(p);
      },
      read_file: function (args, conv) {
        var r = WB.fs.readFile(WB.fsPath(args.path, conv));
        if (!r || !r.ok) return r;
        var content = String(r.content || "");
        var totalLines = content ? content.split("\n").length : 0;
        var meta = { ok: true, path: r.path, bytes: r.bytes || 0, encoding: "utf-8", totalLines: totalLines };
        var from = parseInt(args.from_line, 10);
        var to = parseInt(args.to_line, 10);
        if (from >= 1) {
          // 分段读取：from_line/to_line 为 1 基行号（默认一次最多 200 行，防上下文爆炸）
          var linesArr = content.split("\n");
          var end = (to >= from) ? Math.min(to, linesArr.length) : Math.min(from + 199, linesArr.length);
          meta.from_line = from;
          meta.to_line = end;
          meta.truncated = end < linesArr.length;
          meta.content = linesArr.slice(from - 1, end).join("\n");
          return meta;
        }
        meta.content = content;
        return meta;
      },
      write_file: function (args, conv) {
        if (typeof args.content !== "string") return { ok: false, error: "content 必须为字符串" };
        return WB.fs.writeFile(WB.fsPath(args.path, conv), args.content);
      },
      mkdir: function (args, conv) {
        return WB.fs.mkdir(WB.fsPath(args.path, conv));
      },
      delete_path: function (args, conv) {
        return WB.fs.del(WB.fsPath(args.path, conv));
      },
      workspace_info: function (args, conv) {
        var roots = WB.fs.roots();
        return { ok: true, workspace: conv.workspace || ".", label: conv.workspaceLabel || "", roots: roots.roots || [] };
      },
      fetch_url: async function (args) {
        // 抓取网页：默认返回「可读正文」（而非原始 HTML 前 8000 字符，那样只会看到 head 里的 meta）
        // 参数：{url, method?, headers?, body?, mode?: "auto"|"text"|"html"|"json", max_chars?}
        try {
          var res = await WB.fetchPage(args || {});
          if (res && res.ok && res.mode === "text" && !res.jsRendered && !res.text) {
            res.hint = (res.hint || "") + " 页面正文为空，可能是纯前端渲染或需要登录。";
          }
          return res;
        } catch (e) {
          return { ok: false, error: "抓取失败: " + (e && e.message ? e.message : String(e)) };
        }
      },
      github_push: async function (args, conv) {
        return await WB.github.pushFile(args);
      },
      github_status: function (args, conv) {
        var cfg = WB.github.config();
        return { ok: true, connected: !!cfg, username: cfg ? cfg.username : "", repo: cfg ? (cfg.repo || "") : "" };
      },
      mcp_tool: async function (args) {
        // 复用外部 MCP 服务器工具（mcpClientSystem.callMcpTool）
        try {
          if (window.mcpClientSystem && typeof window.mcpClientSystem.callMcpTool === "function") {
            var result = await window.mcpClientSystem.callMcpTool(args.server, args.tool, args.arguments || {});
            return { ok: true, result: result };
          }
          return { ok: false, error: "MCP 客户端未就绪" };
        } catch (e) {
          return { ok: false, error: "MCP 调用失败: " + e.message };
        }
      },
      github_api: async function (args) {
        // 带认证的通用 GitHub REST API（P0：解锁私有仓库「看」的能力；contents 文件自动 base64 解码）
        try {
          var cfg = WB.github.config();
          if (!cfg || !cfg.token) return { ok: false, error: "未配置 GitHub Token（请先在 设置-GitHub 中配置用户名与 Token；仅在你的 Token 权限范围内访问）" };
          var method = String(args.method || "GET").toUpperCase();
          var apiPath = String(args.api_path || "");
          if (!apiPath) return { ok: false, error: "缺少 api_path（如 /repos/{owner}/{repo}/contents/ 或 /user）" };
          if (apiPath.charAt(0) !== "/") apiPath = "/" + apiPath;
          if (apiPath.indexOf("/repos/") !== 0 && apiPath.indexOf("/user") !== 0 && args.owner && args.repo) {
            apiPath = "/repos/" + encodeURIComponent(args.owner) + "/" + encodeURIComponent(args.repo) + apiPath;
          }
          var headers = { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
          var opts = { method: method, headers: headers };
          if (args.body !== undefined && args.body !== null && method !== "GET") {
            headers["Content-Type"] = "application/json";
            opts.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
          }
          var res = await fetch("https://api.github.com" + apiPath, opts);
          var text = await res.text();
          var json = null; try { json = JSON.parse(text); } catch (e) {}
          if (!res.ok) {
            var msg = (json && json.message) ? json.message : text.slice(0, 300);
            return { ok: false, status: res.status, error: "GitHub API " + res.status + ": " + msg };
          }
          if (json && Array.isArray(json)) {
            // 目录列表：精简为 name/type/size
            return { ok: true, status: res.status, type: "list", data: json.map(function (it) { return { name: it.name, type: it.type, size: it.size, sha: it.sha }; }) };
          }
          if (json && json.content && typeof json.content === "string") {
            // contents API 单文件：base64 解码为可读文本
            var dec = "";
            try {
              var b64 = json.content.replace(/\s+/g, "");
              var bin = atob(b64);
              var bytes = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              dec = new TextDecoder("utf-8").decode(bytes);
            } catch (e2) { dec = "（base64 解码失败: " + e2.message + "）"; }
            return { ok: true, status: res.status, type: "file", name: json.name, path: json.path, sha: json.sha, size: json.size, content: dec.slice(0, 60000) };
          }
          return { ok: true, status: res.status, type: "json", data: json };
        } catch (e) {
          return { ok: false, error: "GitHub API 调用失败: " + e.message };
        }
      },
      actions_list: async function (args) {
        // 查看仓库 CI 运行列表（P1 可观测）
        try {
          var cfg = WB.github.config();
          if (!cfg || !cfg.token) return { ok: false, error: "未配置 GitHub Token" };
          var owner = args.owner || cfg.username;
          var repo = args.repo || cfg.repo;
          if (!owner || !repo) return { ok: false, error: "缺少仓库（传 repo/owner 或在设置中配置默认仓库）" };
          var q = "?per_page=" + (parseInt(args.per_page, 10) || 10) + "&page=1";
          if (args.workflow) q += "&workflow=" + encodeURIComponent(args.workflow);
          var res = await fetch("https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/actions/runs" + q, {
            headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
          });
          var json = null; try { json = await res.json(); } catch (e) {}
          if (!res.ok) return { ok: false, status: res.status, error: (json && json.message) || "查询失败" };
          if (!json || !json.workflow_runs) return { ok: true, data: [] };
          return {
            ok: true, owner: owner, repo: repo,
            data: json.workflow_runs.map(function (r) {
              return { id: r.id, run_number: r.run_number, name: r.name || r.display_title || r.event, workflow_id: r.workflow_id, branch: r.head_branch, sha: String(r.head_sha || "").slice(0, 7), status: r.status, conclusion: r.conclusion, created_at: r.created_at, updated_at: r.updated_at };
            })
          };
        } catch (e) {
          return { ok: false, error: "Actions 查询失败: " + e.message };
        }
      },
      actions_log: async function (args) {
        // 拉取某次 CI 运行日志文本（P1 可观测：能看到报错全文）
        try {
          var cfg = WB.github.config();
          if (!cfg || !cfg.token) return { ok: false, error: "未配置 GitHub Token" };
          var runId = parseInt(args.run_id, 10);
          if (!runId) return { ok: false, error: "缺少 run_id（可用 actions_list 查看）" };
          var owner = args.owner || cfg.username;
          var repo = args.repo || cfg.repo;
          if (!owner || !repo) return { ok: false, error: "缺少仓库" };
          var base = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
          var hdrs = { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
          // 先找 job（日志按 job 提供）
          var jobId = null;
          try {
            var jres = await fetch(base + "/actions/runs/" + runId + "/jobs", { headers: hdrs });
            var jjson = await jres.json();
            if (jres.ok && jjson && jjson.jobs && jjson.jobs.length) jobId = jjson.jobs[0].id;
          } catch (e) {}
          var url = jobId ? base + "/actions/jobs/" + jobId + "/logs" : base + "/actions/runs/" + runId + "/logs";
          var res = await fetch(url, { headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json" } });
          var text = await res.text();
          if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
          var truncated = text.length > 30000;
          return { ok: true, run_id: runId, job_id: jobId, bytes: text.length, truncated: truncated, content: text.slice(-30000) };
        } catch (e) {
          return { ok: false, error: "Actions 日志拉取失败: " + e.message };
        }
      },
      file_search: async function (args, conv) {
        // 按文件名/glob 搜索工作区（P1：替代逐目录人工翻找）
        try {
          var pattern = String(args.pattern || "").trim();
          if (!pattern) return { ok: false, error: "缺少 pattern（如 *.js、**/*.kt、*readme*）" };
          function patToRx(p) {
            var optPrefix = "";
            if (p.indexOf("**/") === 0) { optPrefix = "(?:.*/)?"; p = p.slice(3); }
            var i = 0, out = "";
            while (i < p.length) {
              var c = p[i];
              if (c === "*") { if (p[i + 1] === "*") { out += ".*"; i += 2; } else { out += "[^/]*"; i++; } }
              else if (c === "?") { out += "[^/]"; i++; }
              else if ("\\^$+{}()|[]".indexOf(c) >= 0) { out += "\\" + c; i++; }
              else { out += c; i++; }
            }
            return new RegExp("^" + optPrefix + out + "$");
          }
          var rx = patToRx(pattern);
          var root = WB.fsPath(args.path || ".", conv);
          var out = [];
          var MAX_FILES = 300, MAX_DEPTH = 8;
          var walk = function (dir, depth) {
            if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
            var r = WB.fs.listDir(dir);
            if (!r || !r.ok || !r.entries) return;
            for (var j = 0; j < r.entries.length; j++) {
              var en = r.entries[j];
              if (en.type === "dir") walk(dir === "." ? en.name : dir + "/" + en.name, depth + 1);
              else {
                var rel = dir === "." ? en.name : dir + "/" + en.name;
                if (rx.test(rel)) out.push({ file: rel, size: en.size, modified: en.modified });
              }
            }
          };
          walk(root, 0);
          return { ok: true, root: root, pattern: pattern, matched: out.slice(0, 100), truncated: out.length > 100 };
        } catch (e) {
          return { ok: false, error: "搜索失败: " + e.message };
        }
      },
      grep_search: async function (args, conv) {
        // 按内容搜索工作区文本（P1）
        try {
          var query = String(args.query || "");
          if (!query) return { ok: false, error: "缺少 query（搜索关键字）" };
          var root = WB.fsPath(args.path || ".", conv);
          var rx = null;
          try {
            rx = new RegExp(args.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), args.case_sensitive ? "" : "i");
          } catch (e) { return { ok: false, error: "非法正则: " + e.message }; }
          var out = [];
          var MAX_FILES = 300, MAX_MATCH = 60, MAX_DEPTH = 8;
          var walk = function (dir, depth) {
            if (depth > MAX_DEPTH || out.length >= MAX_MATCH) return;
            var r = WB.fs.listDir(dir);
            if (!r || !r.ok || !r.entries) return;
            for (var j = 0; j < r.entries.length; j++) {
              var en = r.entries[j];
              if (en.type === "dir") walk(dir === "." ? en.name : dir + "/" + en.name, depth + 1);
              else {
                if (out.length >= MAX_MATCH) return;
                var rel = dir === "." ? en.name : dir + "/" + en.name;
                var fr = WB.fs.readFile(rel);
                if (!fr || !fr.ok || !fr.content) continue;
                var content = String(fr.content);
                if (content.indexOf("\u0000") >= 0) continue; // 跳过二进制
                var lines = content.split("\n");
                for (var k = 0; k < lines.length && out.length < MAX_MATCH; k++) {
                  if (rx.test(lines[k])) out.push({ file: rel, line: k + 1, text: lines[k].slice(0, 300) });
                }
              }
            }
          };
          walk(root, 0);
          return { ok: true, root: root, query: query, matches: out, truncated: out.length >= MAX_MATCH };
        } catch (e) {
          return { ok: false, error: "内容搜索失败: " + e.message };
        }
      },
      termux_run: async function (args, conv) {
        // 通过 Termux 常驻 cmd-runner（127.0.0.1:3002）执行命令/脚本（P2 run_sandbox 的落地：AI 自写自用 termux 脚本）
        var cmd = String(args.cmd || "").trim();
        if (!cmd) return { ok: false, error: "缺少 cmd（要执行的 shell 命令或脚本路径，如 bash test.sh 或 git status）" };
        var cwd = args.cwd ? WB._wbAbs(args.cwd, conv) : WB._wbAbs(".", conv);
        var payload = { cmd: cmd, cwd: cwd };
        if (args.timeout_s) payload.timeout_ms = parseInt(args.timeout_s, 10) * 1000;
        try {
          var res = await fetch("http://127.0.0.1:3002/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!res.ok) { var t2 = await res.text(); return { ok: false, status: res.status, error: t2.slice(0, 300) }; }
          return await res.json();
        } catch (e) {
          return { ok: false, error: "无法连接 Termux 命令服务（http://127.0.0.1:3002）。请先完成 设置-本地部署-部署引导（含内置脚本3 cmd-runner），再在 Termux 执行 storyphone start cmd-runner。详情: " + e.message };
        }
      },
      github_clone: async function (args, conv) {
        // 用 Termux git 把远端仓库克隆到工作区（P0 本地镜像：clone → 本地文件工具改 → commit/push）
        var cfg = WB.github.config();
        var url = String(args.url || "").trim();
        if (!url && args.owner && args.repo) url = "https://github.com/" + encodeURIComponent(args.owner) + "/" + encodeURIComponent(args.repo) + ".git";
        if (!url) return { ok: false, error: "缺少 url（或 owner/repo）" };
        var dest = args.path ? WB._wbAbs(args.path, conv) : "";
        var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
        var prefix = "";
        if (cfg && cfg.token) {
          var auth = "Authorization: Basic " + btoa("x-access-token:" + cfg.token);
          prefix = "git -c http.extraHeader=" + q(auth) + " "; // token 不进 .git/config，仅本次进程
        }
        var branch = args.branch ? " --branch " + q(args.branch) : "";
        var cmd = prefix + "git clone" + (args.depth === false ? "" : " --depth 1") + branch + " " + q(url) + (dest ? " " + q(dest) : "");
        var payload = { cmd: cmd, cwd: WB._wbAbs(args.cwd || ".", conv) };
        if (args.timeout_s) payload.timeout_ms = parseInt(args.timeout_s, 10) * 1000;
        try {
          var res = await fetch("http://127.0.0.1:3002/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          var j = await res.json();
          return Object.assign({ ok: true, note: "clone 完成（工作区路径: " + (dest || url.split("/").pop().replace(/\.git$/, "")) + "）" }, j || {});
        } catch (e) {
          return { ok: false, error: "无法连接 Termux 命令服务（http://127.0.0.1:3002）。请先完成 本地部署-部署引导 并 storyphone start cmd-runner。详情: " + e.message };
        }
      },
      github_pull: async function (args, conv) {
        var p = args.path ? WB._wbAbs(args.path, conv) : WB._wbAbs(".", conv);
        var cfg = WB.github.config();
        var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
        var prefix = "";
        if (cfg && cfg.token) {
          var auth = "Authorization: Basic " + btoa("x-access-token:" + cfg.token);
          prefix = "git -c http.extraHeader=" + q(auth) + " ";
        }
        var cmd = prefix + "git -C " + q(p) + " pull --ff-only";
        return await WB.tools._termuxExec(cmd, p, "pull");
      },
      github_commit: async function (args, conv) {
        var p = args.path ? WB._wbAbs(args.path, conv) : WB._wbAbs(".", conv);
        var message = String(args.message || "").trim();
        if (!message) return { ok: false, error: "缺少 message（提交说明）" };
        var cfg = WB.github.config();
        var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
        var name = (cfg && cfg.username) || "storyphone";
        var email = (cfg && cfg.email) || (name + "@users.noreply.github.com");
        var cmd = "git -C " + q(p) + " config user.name " + q(name) + " ; git -C " + q(p) + " config user.email " + q(email) + " ; git -C " + q(p) + " add -A ; git -C " + q(p) + " commit -m " + q(message);
        return await WB.tools._termuxExec(cmd, p, "commit");
      },
      github_push: async function (args, conv) {
        var p = args.path ? WB._wbAbs(args.path, conv) : WB._wbAbs(".", conv);
        var cfg = WB.github.config();
        var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
        var prefix = "";
        if (cfg && cfg.token) {
          var auth = "Authorization: Basic " + btoa("x-access-token:" + cfg.token);
          prefix = "git -c http.extraHeader=" + q(auth) + " ";
        }
        var branch = args.branch ? q(args.branch) : "HEAD";
        var cmd = prefix + "git -C " + q(p) + " push origin " + branch;
        return await WB.tools._termuxExec(cmd, p, "push");
      },
      _termuxExec: async function (cmd, cwd, label) {
        // 共享执行入口（git 工具用）：调用 127.0.0.1:3002 /run
        try {
          var res = await fetch("http://127.0.0.1:3002/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: cmd, cwd: cwd }) });
          var j = await res.json();
          return Object.assign({ ok: true, note: label + " 执行完成" }, j || {});
        } catch (e) {
          return { ok: false, error: "无法连接 Termux 命令服务（http://127.0.0.1:3002）。请先完成 本地部署-部署引导（含 cmd-runner）并执行 storyphone start cmd-runner。详情: " + e.message };
        }
      }
    },
    _wbAbs: function (rel, conv) {
      // 把工作区相对路径换算为 Android 公共工作区的绝对路径（供 Termux cmd-runner 使用）
      var relStr = String(rel == null || rel === "" ? "." : rel).trim();
      try {
        var rr = WB.fs.roots();
        if (rr && rr.roots && rr.roots.length && rr.roots[0] && rr.roots[0].absolute) {
          var abs = String(rr.roots[0].absolute);
          if (relStr === "." || relStr === "/") return abs;
          if (relStr.charAt(0) === "/") return abs + relStr;
          return abs + "/" + relStr;
        }
      } catch (e) {}
      return relStr; // 无法解析根时退回相对路径（由 cmd-runner 在 termux $HOME 解析）
    },

    /** 把 Agent 传来的相对路径换算为对话工作区下的实际路径 */
    fsPath: function (rel, conv) {
      var p = String(rel || "").trim();
      if (!p || p === ".") return conv.workspace || ".";
      if (p.indexOf("/") === 0) return conv.workspace + p;
      if (conv.workspace && conv.workspace !== ".") return conv.workspace + "/" + p;
      return p;
    },

    // ==================== 工具执行 ====================
    executeTool: async function (tool, args, conv) {
      var fn = this.tools[tool];
      if (!fn) return { ok: false, error: "未知工具: " + tool + "（可用工具: " + Object.keys(this.tools).join(", ") + "）" };
      try {
        var result = await fn(args || {}, conv);
        if (result === undefined) result = { ok: true, note: "执行完成" };
        return result;
      } catch (e) {
        return { ok: false, error: "工具执行异常: " + e.message };
      }
    },
    // ==================== LLM 调用（复用全局 fetchStreamOrJson 流式引擎） ====================
    /** 工作台自有流式调用（含 usage 捕获：token 统计与缓存命中） */
    wbStreamChat: async function (baseUrl, api, messages, signal, onChunk, onUsage) {
      var cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      var endpoint = cleanBaseUrl.indexOf("/chat/completions") > 0 ? cleanBaseUrl : cleanBaseUrl + "/chat/completions";
      var streamEnabled = !api.disableStream;
      if (streamEnabled) {
        // 流式悬挂保护：内部 AbortController + 空闲超时，与外部 signal 联动
        var streamCtrl = new AbortController();
        var outerAborted = false;
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', function () { outerAborted = true; try { streamCtrl.abort(); } catch (e) {} });
        }
        var IDLE_TIMEOUT = 90000; // 90s 无新数据视为悬挂
        var timeoutTimer = setTimeout(function () { try { streamCtrl.abort(); } catch (e) {} }, IDLE_TIMEOUT);
        function resetIdleTimer() {
          try { clearTimeout(timeoutTimer); } catch (e) {}
          timeoutTimer = setTimeout(function () { try { streamCtrl.abort(); } catch (e) {} }, IDLE_TIMEOUT);
        }
        var response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream, application/json, */*", "Authorization": "Bearer " + api.key },
          body: JSON.stringify({ model: api.model, messages: messages, temperature: api.temperature, stream: true }),
          signal: streamCtrl.signal
        });
        if (!response.ok) {
          var errText = await response.text();
          throw new Error("HTTP " + response.status + " " + String(errText).slice(0, 300));
        }
        if (!response.body) throw new Error("响应流不可用");
        var reader = response.body.getReader();
        var decoder = new TextDecoder("utf-8");
        var buffer = "";
        var contentText = "";
        var usage = null;
        function checkOuterAborted() { return outerAborted; }
        while (true) {
          var r = await reader.read();
          if (r.done) break;
          resetIdleTimer();
          buffer += decoder.decode(r.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf("data: ") !== 0) continue;
            var dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              var parsed = JSON.parse(dataStr);
              var delta = (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) || "";
              if (delta) {
                contentText += delta;
                if (onChunk) onChunk(delta, contentText);
              }
              if (parsed.usage) usage = parsed.usage;
            } catch (e) {}
          }
        }
        try { clearTimeout(timeoutTimer); } catch (e) {}
        if (usage && onUsage) onUsage(usage);
        return contentText;
      }
      var res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, */*", "Authorization": "Bearer " + api.key },
        body: JSON.stringify({ model: api.model, messages: messages, temperature: api.temperature, stream: false }),
        signal: signal
      });
      if (!res.ok) {
        var t = await res.text();
        throw new Error("HTTP " + res.status + " " + String(t).slice(0, 300));
      }
      var result = await res.json();
      if (result && result.usage && onUsage) onUsage(result.usage);
      var content = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || "";
      return content;
    },

    getApiPreset: async function () {
      try {
        var presets = await db.api_presets.toArray();
        var active = presets.find(function (p) { return p.enabled; });
        return active || presets[0] || null;
      } catch (e) { return null; }
    },
    estimateTokens: function (text) {
      if (!text) return 0;
      var cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
      var other = text.length - cjk;
      return Math.ceil(cjk / 1.5 + other / 4);
    },

    // ==================== Agent 引擎 ====================
    buildSystemPrompt: function (conv) {
      var cfg = WB.github.config();
      var lines = [];
      lines.push("你是一个运行在手机端工作台里的全能 AI Agent（叙事诗小手机 · 工作台）。");
      lines.push("你可以读取、创建、修改本地工作区文件，向 GitHub 推送文件，抓取网页，调用 MCP 工具，像一名工程师一样帮用户完成实际任务。");
      lines.push("");
      lines.push("【当前对话工作区】");
      lines.push("- 工作区: " + (conv.workspaceLabel || conv.workspace || "."));
      lines.push("- 工作区路径(相对根): " + (conv.workspace || "."));
      lines.push("");
      lines.push("【GitHub 连接】" + (cfg && cfg.token ? "已连接（用户名: " + (cfg.username || "") + (cfg.repo ? "，默认仓库: " + cfg.repo : "") + "）" : "未连接（用户可在设置中配置用户名与 Token）"));
      lines.push("");
      lines.push("【可用工具（通过工具标签调用）】");
      lines.push("1. list_dir: 列出目录内容。参数 {path}（相对工作区）");
      lines.push("2. read_file: 读取文本文件。参数 {path, from_line?, to_line?}（from/to 为 1 基行号，可分段读大文件；返回含 bytes/totalLines/truncated 头注）");
      lines.push("3. write_file: 写入/创建文本文件。参数 {path, content}");
      lines.push("4. mkdir: 创建目录。参数 {path}");
      lines.push("5. delete_path: 删除文件或目录。参数 {path}");
      lines.push("6. workspace_info: 查看工作区信息");
      lines.push("7. fetch_url: 抓取网页/接口。参数 {url, method?, headers?, body?, mode?(\"auto\"|\"text\"|\"html\"|\"json\"), max_chars?(默认10000，上限20000)}。默认返回抽取好的可读正文（title/description/text/links），不是原始 HTML；接口返回 JSON 时自动结构化。若结果带 jsRendered:true，说明该页正文由 JS 动态渲染（服务端 HTML 无内容），此时优先读返回里的 embeddedJson/embeddedKeys（SPA 数据源），或改用该站点的数据接口（Network 面板找 XHR/Fetch 真实 URL 后用 mode:\"json\" 请求）");
      lines.push("8. github_push: 推送文件到 GitHub。参数 {path(仓库内路径), content, message?, repo?, owner?, branch?}");
      lines.push("9. github_status: 查看 GitHub 连接状态");
      lines.push("10. mcp_tool: 调用已配置的外部 MCP 服务器工具。参数 {server, tool, arguments}");
      lines.push("11. github_api: 带认证调用 GitHub REST API（能看私有仓库）。参数 {method?, api_path, body?, owner?, repo?}，如 api_path=\"/repos/{owner}/{repo}/contents/\"；contents 目录返回列表、文件自动 base64 解码；也可查 commits/issues/Actions 等");
      lines.push("12. actions_list: 查看仓库 CI 运行列表。参数 {repo?, owner?, workflow?, per_page?}");
      lines.push("13. actions_log: 拉取某次 CI 运行日志文本（排障用）。参数 {run_id 必填, repo?, owner?}");
      lines.push("14. file_search: 按文件名/glob 搜索工作区。参数 {pattern, path?}，如 *.js、**/*.kt");
      lines.push("15. grep_search: 按内容搜索工作区文本。参数 {query, path?, case_sensitive?}，返回 文件:行号:匹配行");
      lines.push("16. termux_run: 在手机 Termux 中执行命令/脚本（需先完成 设置-本地部署 的第 3 个内置服务 cmd-runner；git 仓库类操作请用 github_clone/github_pull/github_commit/github_push，见第 17 节）。参数 {cmd, cwd?, timeout_s?}");
      lines.push("17. github_clone: 用 Termux git 把远端仓库克隆到工作区。参数 {url 或 owner/repo, path?, branch?}");
      lines.push("18. github_commit: 在本地仓库提交改动。参数 {path(仓库目录), message}");
      lines.push("19. github_push: 把本地仓库改动推送到远端。参数 {path(仓库目录), branch?}");
      lines.push("");
      lines.push("【工具调用语法（极其重要）】");
      lines.push("当你需要调用工具时，在你的回复中单独输出一行（必须单独占一行）：");
      lines.push("[WB_TOOL:{\"tool\":\"工具名\",\"arguments\":{...}}]");
      lines.push("执行结果会自动作为新消息返回给你，你可以继续调用或给出最终结论。一行只放一个工具调用。");
      lines.push("路径一律使用相对工作区的路径；写文件前如不确定可先 list_dir / read_file 查看。");
      lines.push("");
      lines.push("【行为准则】");
      lines.push("- 先思考用户要达成的目标，分步骤使用工具，不要一次输出多个工具调用标签；");
      lines.push("- 工具结果较长时，提炼要点后再继续；");
      lines.push("- 任务完成后，用自然语言向用户汇报做了什么、结果如何、文件在哪；");
      lines.push("- 涉及删除/覆盖等危险操作前，先明确告知用户并获得同意。");
      if (conv.systemPrompt) {
        lines.push("");
        lines.push("【用户为本对话设定的补充规则】");
        lines.push(conv.systemPrompt);
      }
      return lines.join("\n");
    },

    buildMessages: function (conv, history) {
      var sys = this.buildSystemPrompt(conv);
      var msgs = [{ role: "system", content: sys }];
      if (conv.summary) {
        msgs.push({ role: "system", content: "【较早对话摘要】" + conv.summary });
      }
      var budget = WB.MAX_CONTEXT_TOKENS - WB.estimateTokens(sys) - (conv.summary ? WB.estimateTokens(conv.summary) : 0);
      var recent = [];
      for (var i = history.length - 1; i >= 0; i--) {
        var m = history[i];
        var t = WB.estimateTokens(m.content || "");
        if (budget - t < 200 && recent.length > 2) break;
        recent.unshift({ role: m.role === "assistant" ? "assistant" : "user", content: m.content || "" });
        budget -= t;
      }
      return msgs.concat(recent);
    },

    parseToolCall: function (text) {
      var re = /\[\s*WB_TOOL\s*:\s*(\{[\s\S]*?\})\s*\]/i;
      var m = String(text || "").match(re);
      if (!m) return null;
      try {
        var obj = JSON.parse(m[1]);
        if (!obj || typeof obj.tool !== "string") return null;
        return { fullMatch: m[0], tool: obj.tool, arguments: obj.arguments || {} };
      } catch (e) { return null; }
    },
    /** 解析一条回复中的全部工具调用（对标 Claude/OpenAI 多 tool_calls）
     *  用状态机扫描：跳过字符串内的引号/转义/括号，正确处理 content 中含任意代码（[]{}、"、\n）的标签 */
    parseToolCalls: function (text) {
      var s = String(text || "");
      var out = [];
      var i = 0;
      var n = s.length;
      var tagRe = /\[\s*WB_TOOL\s*:/gi;
      var m;
      while ((m = tagRe.exec(s)) !== null) {
        var start = m.index + m[0].length;
        // 找到真正的 JSON 对象：从 { 开始状态机扫描到配对的 }
        var braceAt = s.indexOf('{', start);
        if (braceAt < 0) { if (tagRe.lastIndex === m.index + 1) tagRe.lastIndex++; continue; }
        var depth = 0;
        var inStr = false;
        var esc = false;
        var endBrace = -1;
        for (var j = braceAt; j < s.length; j++) {
          var ch = s.charAt(j);
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
          } else {
            if (ch === '"') inStr = true;
            else if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endBrace = j; break; } }
          }
        }
        if (endBrace < 0) { if (tagRe.lastIndex === m.index + 1) tagRe.lastIndex++; continue; }
        // 确认后面是 ]（允许空格）
        var k = endBrace + 1;
        while (k < s.length && /\s/.test(s.charAt(k))) k++;
        if (s.charAt(k) !== ']') { if (tagRe.lastIndex === m.index + 1) tagRe.lastIndex++; continue; }
        var jsonStr = s.slice(braceAt, endBrace + 1);
        try {
          var obj = JSON.parse(jsonStr);
          if (obj && typeof obj.tool === "string") {
            out.push({ fullMatch: s.slice(m.index, k + 1), tool: obj.tool, arguments: obj.arguments || {}, index: m.index, raw: jsonStr });
          }
        } catch (e) {}
        tagRe.lastIndex = k + 1;
      }
      return out;
    },
    /** 检测文本中是否存在 WB_TOOL 标记（无论格式是否规范） */
    hasToolTag: function (text) {
      return /\[\s*WB_TOOL\s*:/i.test(String(text || ''));
    },

    runAgent: async function (conv, userText) {
      if (this.state.sending) return;
      this.state.sending = true;
      var preset = await this.getApiPreset();
      if (!preset || !preset.url || !preset.key) {
        this.appendSysMsg("未配置可用 API（请先在 设置-API 服务 中配置并启用一个服务）");
        this.state.sending = false;
        return;
      }
      var seq = (await this.msgs(conv.id)).length;
      var turnTokensIn = 0, turnTokensOut = 0, turnCache = 0;

      await this.addMsg({ convId: conv.id, seq: seq++, role: "user", content: userText, createdAt: Date.now() });
      this.appendBubble("user", userText);

      var history = await this.msgs(conv.id);
      var messages = this.buildMessages(conv, history);
      var loop = 0;
      var aborted = false;

      while (loop < WB.MAX_TOOL_LOOPS && !aborted) {
        loop++;
        var reply = "";
        var usage = null;
        var ctrl = new AbortController();
        this.state.abortCtrl = ctrl;
        var bubble = this.appendBubble("assistant", "");
        try {
          reply = await this.wbStreamChat(
            preset.url,
            { key: preset.key, model: preset.model, temperature: preset.temperature },
            messages,
            ctrl.signal,
            function (delta, fullText) {
              reply = fullText;
              if (bubble && bubble._el) bubble._el.textContent = fullText;
            },
            function (u) { usage = u; }
          );
        } catch (e) {
          if (e && e.name === "AbortError") { aborted = true; }
          else {
            this.appendSysMsg("请求失败: " + (e && e.message ? e.message : String(e)));
            this.state.sending = false;
            return;
          }
        }
        if (aborted) break;

        if (usage && usage.prompt_tokens) turnTokensIn += usage.prompt_tokens;
        if (usage && usage.completion_tokens) turnTokensOut += usage.completion_tokens;
        if (usage && usage.prompt_cache_hit_tokens) turnCache += usage.prompt_cache_hit_tokens;

        await this.addMsg({ convId: conv.id, seq: seq++, role: "assistant", content: reply, createdAt: Date.now() });
        if (bubble && bubble._el) bubble._el.textContent = reply;

        var toolCall = this.parseToolCall(reply);
        if (!toolCall) break;

        var card = this.appendToolCard(toolCall.tool, toolCall.arguments);
        var result = await this.executeTool(toolCall.tool, toolCall.arguments, conv);
        card._render(result);
        var resultText = JSON.stringify(result);
        if (resultText.length > 6000) resultText = resultText.slice(0, 6000) + "...(截断)";
        await this.addMsg({ convId: conv.id, seq: seq++, role: "tool", content: resultText, createdAt: Date.now() });
        messages = messages.concat([
          { role: "assistant", content: reply },
          { role: "user", content: "[工具结果] " + resultText }
        ]);
        if (messages.length > 40) {
          messages = messages.slice(-30);
          messages.unshift({ role: "system", content: "（上下文已裁剪，保留最近对话）" });
        }
      }

      var convPatch = {
        totalTokensIn: (conv.totalTokensIn || 0) + turnTokensIn,
        totalTokensOut: (conv.totalTokensOut || 0) + turnTokensOut,
        cacheHits: (conv.cacheHits || 0) + turnCache
      };
      if (!conv.title || conv.title === "未命名会话") {
        convPatch.title = userText.slice(0, 18) + (userText.length > 18 ? "..." : "");
      }
      await this.updateConv(conv.id, convPatch);
      conv = Object.assign(conv, convPatch);
      this.updateChatHeader(conv);
      this.state.sending = false;
      this.state.abortCtrl = null;
      this.scrollToBottom();
    },

    stopAgent: function () {
      if (this.state.abortCtrl) {
        try { this.state.abortCtrl.abort(); } catch (e) {}
        this.state.abortCtrl = null;
      }
      this.state.sending = false;
      var btn = document.getElementById("wb-send-btn");
      if (btn) btn.style.display = "flex";
      var stopBtn = document.getElementById("wb-stop-btn");
      if (stopBtn) stopBtn.style.display = "none";
    },
    // ==================== 渲染：视图 ====================
    init: function () {
      var body = document.getElementById("wb-body");
      if (!body) return;
      this.bindClose();
      this.renderList();
    },

    bindClose: function () {
      var btn = document.getElementById("wb-close-btn");
      if (btn) btn.onclick = function () { if (typeof closeApp === "function") closeApp("workbench"); };
    },

    svg: function (d, size, extra) {
      size = size || 16;
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;' + (extra || "") + '">' + d + '</svg>';
    },

    // ============ 会话列表 ============
    renderList: function () {
      var self = this;
      this.state.view = "list";
      this.state.activeConvId = null;
      var body = document.getElementById("wb-body");
      if (!body) return;
      this.convs().then(function (convs) {
        var cfg = self.github.config();
        var cards = convs.map(function (c) {
          var gh = c.github ? '<span style="display:inline-flex;align-items:center;gap:2px;font-size:9px;color:#16a34a;background:#dcfce7;border-radius:4px;padding:1px 5px;">' + self.svg('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>', 10) + 'GitHub</span>' : "";
          var ws = c.workspaceLabel ? '<span style="display:inline-flex;align-items:center;gap:2px;font-size:9px;color:#0e7490;background:#cffafe;border-radius:4px;padding:1px 5px;">' + self.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 10) + self.esc(c.workspaceLabel) + '</span>' : "";
          var time = self.fmtTime(c.updatedAt);
          var tokens = '<span style="font-size:9px;color:#64748b;">↑' + (c.totalTokensIn || 0) + ' ↓' + (c.totalTokensOut || 0) + '</span>';
          return '<div class="wb-conv-card" data-id="' + c.id + '" style="background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px;cursor:pointer;transition:all .15s;box-shadow:var(--shadow-sm);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.esc(c.title) + '</div>' +
              '<div style="display:flex;align-items:center;gap:4px;">' + gh + ws + tokens + '</div>' +
            '</div>' +
            (c.summary ? '<div style="font-size:10px;color:var(--text-secondary);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">摘要: ' + self.esc(c.summary) + '</div>' : '') +
            '<div style="font-size:10px;color:#94a3b8;margin-top:8px;display:flex;align-items:center;justify-content:space-between;">' +
              '<span>' + self.fmtDate(c.updatedAt) + ' ' + time + '</span>' +
              '<button class="wb-del-btn" data-id="' + c.id + '" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:2px;">' + self.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 15) + '</button>' +
            '</div>' +
          '</div>';
        }).join("");

        body.innerHTML =
          '<div style="display:flex;flex-direction:column;height:100%;">' +
            '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);">' +
              '<div style="font-size:15px;font-weight:700;color:var(--text-primary);flex:1;display:flex;align-items:center;gap:6px;">' + self.svg('<path d="m7 8 3 3-3 3"/><path d="M12 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/>', 18) + '工作台</div>' +
              '<button class="wb-icon-btn" id="wb-github-btn" title="GitHub 连接" style="border:1.5px solid var(--border);background:#fff;border-radius:10px;padding:7px;cursor:pointer;color:' + (cfg && cfg.token ? "#16a34a" : "#94a3b8") + ';">' + self.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 17) + '</button>' +
              '<button class="wb-icon-btn" id="wb-new-btn" style="border:none;background:var(--primary);border-radius:10px;padding:7px 12px;cursor:pointer;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px;">' + self.svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 14) + '新建</button>' +
            '</div>' +
            '<div id="wb-list" style="flex:1;overflow-y:auto;padding:12px 14px;">' +
              (cards || '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:60px 20px;line-height:1.8;">' + self.svg('<path d="M9.813 15.904 9 18l.75.75L12 17.25l2.25 2.25L15 18l-.813-2.096a4.5 4.5 0 0 0-4.374 0z"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>', 40, "color:#cbd5e1;display:block;margin:0 auto 10px;") + '还没有会话<br>点击右上角新建，开始你的第一个 Agent 任务') +
            '</div>' +
            '<div style="padding:8px 14px;border-top:1px solid var(--border);font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:4px;">' + self.svg('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>', 12) + '工作台 Agent · 本地工作区 + GitHub 推送 · 数据仅存本机' + '</div>' +
          '</div>';

        // 事件
        var listEl = document.getElementById("wb-list");
        listEl.querySelectorAll(".wb-conv-card").forEach(function (card) {
          card.addEventListener("click", function (ev) {
            if (ev.target.closest(".wb-del-btn")) return;
            self.showChat(Number(card.getAttribute("data-id")));
          });
        });
        listEl.querySelectorAll(".wb-del-btn").forEach(function (btn) {
          btn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            var id = Number(btn.getAttribute("data-id"));
            self.confirmDialog("删除会话", "确定删除该会话及其全部对话记录吗？此操作不可恢复。", function () {
              self.delConv(id).then(function () { self.renderList(); });
            });
          });
        });
        document.getElementById("wb-new-btn").onclick = function () { self.showNewConvDialog(); };
        document.getElementById("wb-github-btn").onclick = function () { self.showGithubConfigDialog(); };
      });
    },

    // ============ 对话视图 ============
    showChat: function (convId) {
      var self = this;
      this.getConv(convId).then(function (conv) {
        if (!conv) return;
        self.state.view = "chat";
        self.state.activeConvId = conv.id;
        self.msgs(conv.id).then(function (msgs) {
          self.renderChat(conv, msgs);
        });
      });
    },

    renderChat: function (conv, msgs) {
      var self = this;
      var body = document.getElementById("wb-body");
      if (!body) return;
      var cfg = this.github.config();
      var ghBadge = conv.github
        ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:#16a34a;background:#dcfce7;border-radius:6px;padding:2px 6px;">' + this.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 11) + (cfg ? cfg.username : "") + '</span>'
        : '<span style="font-size:9px;color:#94a3b8;background:#f1f5f9;border-radius:6px;padding:2px 6px;">未连 GitHub</span>';
      var wsBadge = '<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:#0e7490;background:#cffafe;border-radius:6px;padding:2px 6px;">' + this.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 11) + this.esc(conv.workspaceLabel || "工作台私有区") + '</span>';

      body.innerHTML =
        '<div style="display:flex;flex-direction:column;height:100%;">' +
          '<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
            '<button class="wb-icon-btn" id="wb-back-btn" style="border:none;background:none;color:#475569;cursor:pointer;padding:4px;">' + this.svg('<path d="M15 18l-6-6 6-6"/>', 18) + '</button>' +
            '<div style="flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this.esc(conv.title) + '</div>' +
            wsBadge + ghBadge +
            '<span id="wb-usage" style="font-size:9px;color:#64748b;">↑' + (conv.totalTokensIn || 0) + ' ↓' + (conv.totalTokensOut || 0) + (conv.cacheHits ? ' 缓存:' + conv.cacheHits : '') + '</span>' +
            '<button class="wb-icon-btn" id="wb-conv-menu" style="border:none;background:none;color:#64748b;cursor:pointer;padding:4px;">' + this.svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', 16) + '</button>' +
          '</div>' +
          '<div id="wb-msgs" style="flex:1;overflow-y:auto;padding:12px 12px 8px 12px;display:flex;flex-direction:column;gap:10px;"></div>' +
          '<div style="border-top:1px solid var(--border);padding:8px 10px;background:#fff;">' +
            '<textarea id="wb-input" rows="2" placeholder="输入任务，例如：在工作区创建一个项目并写入示例代码，然后推送到 GitHub..." style="width:100%;box-sizing:border-box;border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;font-size:13px;resize:none;outline:none;color:var(--text-primary);background:#f8fafc;line-height:1.5;"></textarea>' +
            '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">' +
              (this.fs._guard()
                ? '<button class="wb-icon-btn" id="wb-ws-pick" title="切换工作区" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:6px;cursor:pointer;color:#0e7490;">' + this.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 15) + '</button>' +
                '<span style="flex:1;font-size:9px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this.esc(conv.workspaceLabel || "工作台私有区") + '</span>'
                : '<span style="flex:1;font-size:9px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">链接版：仅 GitHub 连接</span>') +
              '<button id="wb-stop-btn" style="display:none;border:none;background:#ef4444;color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">' + this.svg('<rect x="6" y="6" width="12" height="12" rx="2"/>', 13) + '停止</button>' +
              '<button id="wb-send-btn" style="border:none;background:var(--primary);color:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;">' + this.svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>', 13) + '发送</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      var msgsEl = document.getElementById("wb-msgs");
      msgs.forEach(function (m) {
        self.renderStoredMsg(msgsEl, m);
      });
      this.scrollToBottom();

      document.getElementById("wb-back-btn").onclick = function () { self.renderList(); };
      document.getElementById("wb-send-btn").onclick = function () { self.onSend(conv); };
      document.getElementById("wb-stop-btn").onclick = function () { self.stopAgent(); };
      var wsPick = document.getElementById("wb-ws-pick");
      if (wsPick) {
        wsPick.onclick = function () {
          self.showWorkspacePicker(function (path, label) {
            self.updateConv(conv.id, { workspace: path, workspaceLabel: label });
            conv.workspace = path; conv.workspaceLabel = label;
            self.showChat(conv.id);
          });
        };
      }
      document.getElementById("wb-conv-menu").onclick = function () { self.showConvMenu(conv); };
      document.getElementById("wb-input").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          self.onSend(conv);
        }
      });
      document.getElementById("wb-input").focus();
      if (this.state.sending) {
        document.getElementById("wb-send-btn").style.display = "none";
        document.getElementById("wb-stop-btn").style.display = "flex";
      }
    },

    onSend: function (conv) {
      var input = document.getElementById("wb-input");
      if (!input) return;
      var text = input.value.trim();
      if (!text || this.state.sending) return;
      input.value = "";
      this.runAgent(conv, text);
    },

    renderStoredMsg: function (container, m) {
      var self = this;
      if (m.role === "user") {
        self.appendBubble("user", m.content);
      } else if (m.role === "assistant") {
        self.appendBubble("assistant", m.content);
      } else if (m.role === "tool") {
        // 历史工具结果折叠显示
        var div = document.createElement("div");
        div.style.cssText = "align-self:flex-start;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:10px;padding:8px 10px;font-size:10px;color:#64748b;max-width:88%;word-break:break-all;";
        div.textContent = "[工具结果] " + m.content.slice(0, 300) + (m.content.length > 300 ? "..." : "");
        container.appendChild(div);
      } else {
        var sys = document.createElement("div");
        sys.style.cssText = "align-self:center;font-size:10px;color:#94a3b8;background:#f8fafc;border-radius:8px;padding:4px 10px;max-width:80%;";
        sys.textContent = m.content;
        container.appendChild(sys);
      }
    },

    appendBubble: function (role, text) {
      var el = document.getElementById("wb-msgs");
      if (!el) return null;
      var wrap = document.createElement("div");
      wrap.style.cssText = role === "user"
        ? "align-self:flex-end;background:var(--primary);color:#fff;border-radius:14px 14px 4px 14px;padding:9px 12px;max-width:82%;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;box-shadow:var(--shadow-sm);"
        : "align-self:flex-start;background:#fff;border:1.5px solid var(--border);color:var(--text-primary);border-radius:14px 14px 14px 4px;padding:9px 12px;max-width:86%;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;box-shadow:var(--shadow-sm);";
      var content = document.createElement("div");
      content.style.cssText = "min-height:1em;";
      content.textContent = text || "";
      wrap.appendChild(content);
      el.appendChild(wrap);
      this.scrollToBottom();
      return { _el: content };
    },

    appendSysMsg: function (text) {
      var el = document.getElementById("wb-msgs");
      if (!el) return;
      var div = document.createElement("div");
      div.style.cssText = "align-self:center;font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:5px 12px;max-width:85%;";
      div.textContent = text;
      el.appendChild(div);
      this.scrollToBottom();
    },

    appendToolCard: function (tool, args) {
      var el = document.getElementById("wb-msgs");
      var card = document.createElement("div");
      card.style.cssText = "align-self:flex-start;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:8px 12px;width:88%;box-sizing:border-box;";
      card.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#0369a1;">' + this.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 13) + '调用工具: ' + this.esc(tool) +
        '<span style="margin-left:auto;font-weight:400;color:#94a3b8;">' + this.esc(JSON.stringify(args || {}).slice(0, 80)) + '</span></div>' +
        '<div class="wb-tool-result" style="margin-top:6px;font-size:10px;color:#475569;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;"></div>';
      el.appendChild(card);
      this.scrollToBottom();
      return {
        _render: function (result) {
          var box = card.querySelector(".wb-tool-result");
          if (!box) return;
          if (result && result.ok) {
            box.style.color = "#15803d";
            box.textContent = result.error ? ("执行完成: " + result.error) : (result.message || "执行完成");
            if (result.entries && Array.isArray(result.entries)) {
              box.textContent = "共 " + result.entries.length + " 项: " + result.entries.map(function (en) { return en.name + (en.type === "dir" ? "/" : ""); }).join(", ").slice(0, 500);
            }
            if (result.content !== undefined) {
              box.textContent = String(result.content).slice(0, 2000);
            }
          } else {
            box.style.color = "#dc2626";
            box.textContent = "失败: " + ((result && result.error) || "未知错误");
          }
        }
      };
    },

    updateChatHeader: function (conv) {
      var usageEl = document.getElementById("wb-usage");
      if (usageEl) usageEl.textContent = "↑" + (conv.totalTokensIn || 0) + " ↓" + (conv.totalTokensOut || 0) + (conv.cacheHits ? " 缓存:" + conv.cacheHits : "");
    },

    scrollToBottom: function () {
      var el = document.getElementById("wb-msgs");
      if (el) el.scrollTop = el.scrollHeight;
    },

    // ============ 会话菜单 ============
    showConvMenu: function (conv) {
      var self = this;
      var items = [
        { label: "重命名会话", fn: function () { self.promptDialog("重命名会话", "输入新的会话标题", conv.title, function (val) { if (val) self.updateConv(conv.id, { title: val }); self.showChat(conv.id); }); } },
        { label: "切换 GitHub 连接状态", fn: function () {
          self.confirmDialog("GitHub 连接", conv.github ? "当前已连接 GitHub，是否断开本会话的 GitHub 标记？（不影响全局配置）" : "为当前会话标记为连接 GitHub？（需先在全局配置用户名与 Token）", function () {
            self.updateConv(conv.id, { github: !conv.github });
            self.showChat(conv.id);
          });
        } },
        { label: "清空本会话消息", fn: function () {
          self.confirmDialog("清空消息", "确定清空本会话全部消息记录吗？", function () {
            self.delConv(conv.id).then(function () {
              self.addConv({ title: conv.title, workspace: conv.workspace, workspaceLabel: conv.workspaceLabel, github: conv.github, systemPrompt: conv.systemPrompt }).then(function (newId) {
                self.showChat(newId);
              });
            });
          });
        } },
        { label: "删除会话", fn: function () {
          self.confirmDialog("删除会话", "确定删除该会话及全部记录吗？", function () {
            self.delConv(conv.id).then(function () { self.renderList(); });
          });
        } }
      ];
      var box = document.createElement("div");
      box.style.cssText = "position:fixed;top:70px;right:12px;background:#fff;border:1.5px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,0.12);z-index:100010;min-width:180px;overflow:hidden;";
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.textContent = it.label;
        b.style.cssText = "display:block;width:100%;padding:10px 14px;border:none;background:#fff;cursor:pointer;font-size:12px;color:var(--text-primary);text-align:left;";
        b.addEventListener("mouseenter", function () { b.style.background = "#f1f5f9"; });
        b.addEventListener("mouseleave", function () { b.style.background = "#fff"; });
        b.addEventListener("click", function () { box.remove(); it.fn(); });
        box.appendChild(b);
      });
      document.body.appendChild(box);
      setTimeout(function () {
        document.addEventListener("click", function handler(ev) {
          if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("click", handler); }
        });
      }, 0);
    },
    // ==================== 弹窗（自制卡片，禁止原生） ====================
    overlay: function (contentHtml, width) {
      var mask = document.createElement("div");
      mask.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;";
      var card = document.createElement("div");
      card.style.cssText = "background:#fff;border-radius:16px;width:" + (width || 360) + "px;max-width:94vw;max-height:84vh;overflow-y:auto;padding:18px;box-shadow:0 24px 60px rgba(15,23,42,0.25);";
      card.innerHTML = contentHtml;
      mask.appendChild(card);
      mask.addEventListener("click", function (ev) { if (ev.target === mask) mask.remove(); });
      document.body.appendChild(mask);
      return { mask: mask, card: card, close: function () { mask.remove(); } };
    },

    confirmDialog: function (title, msg, onOk) {
      var self = this;
      if (typeof window.showCustomConfirm === "function") {
        window.showCustomConfirm(title, msg, function () { if (onOk) onOk(); });
        return;
      }
      var dlg = this.overlay(
        '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">' + this.svg('<path d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>', 18, "color:#f59e0b;") + this.esc(title) + '</div>' +
        '<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;white-space:pre-wrap;">' + this.esc(msg) + '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
          '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">确定</button>' +
        '</div>'
      );
      dlg.card.querySelector(".wb-dlg-cancel").onclick = function () { dlg.close(); };
      dlg.card.querySelector(".wb-dlg-ok").onclick = function () { dlg.close(); if (onOk) onOk(); };
    },

    promptDialog: function (title, msg, def, onOk) {
      var self = this;
      if (typeof window.showCustomPrompt === "function") {
        window.showCustomPrompt(title, msg, def, function (val) { if (onOk) onOk(val); });
        return;
      }
      var dlg = this.overlay(
        '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">' + this.esc(title) + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">' + this.esc(msg) + '</div>' +
        '<input class="wb-dlg-input" type="text" value="' + this.esc(def || "") + '" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;outline:none;margin-bottom:14px;">' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
          '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">确定</button>' +
        '</div>'
      );
      dlg.card.querySelector(".wb-dlg-cancel").onclick = function () { dlg.close(); };
      dlg.card.querySelector(".wb-dlg-ok").onclick = function () {
        var v = dlg.card.querySelector(".wb-dlg-input").value;
        dlg.close();
        if (onOk) onOk(v);
      };
    },

    // ============ 新建会话 ============
    showNewConvDialog: function () {
      var self = this;
      var wsLabel = "工作区(Download/workbench)";
      var wsPath = ".";
      // 动态获取实际工作区路径（Download 或回退私有）
      try {
        if (this.fs._guard()) {
          var rInfo = this.fs.roots();
          if (rInfo && rInfo.roots && rInfo.roots.length) {
            var r0 = rInfo.roots[0];
            wsLabel = r0.absolute || wsLabel;
          }
        }
      } catch (e) {}
      var dlg = this.overlay(
        '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 18, "color:var(--primary);") + '新建工作台会话</div>' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">会话标题</div>' +
        '<input id="wb-new-title" type="text" placeholder="例如: 搭建一个天气查询工具" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;outline:none;margin-bottom:10px;">' +
        (this.fs._guard()
          ? '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">专属本地工作区</div>' +
            '<button id="wb-new-ws" style="width:100%;display:flex;align-items:center;gap:6px;padding:9px;border:1.5px dashed var(--border);border-radius:10px;background:#f8fafc;font-size:12px;color:#0e7490;cursor:pointer;margin-bottom:10px;">' + this.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 14) + '<span id="wb-new-ws-label" style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this.esc(wsLabel) + '</span>' + this.svg('<path d="M9 18l6-6-6-6"/>', 14) + '</button>'
          : '<div style="font-size:11px;color:#94a3b8;line-height:1.6;margin-bottom:10px;background:#f8fafc;border:1.5px dashed var(--border);border-radius:10px;padding:9px;">链接版（网页/PWA）无本地文件系统，本会话仅支持 GitHub 连接工作。</div>') +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px;border:1.5px solid var(--border);border-radius:10px;background:#fff;margin-bottom:10px;">' +
          '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-primary);">' + this.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 15, 'color:#16a34a;') + '连接 GitHub' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="wb-new-gh" style="width:16px;height:16px;accent-color:var(--primary);"><span style="font-size:11px;color:var(--text-secondary);">推送/拉取仓库文件</span></label>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">会话规则（可选）</div>' +
        '<textarea id="wb-new-sys" rows="2" placeholder="例如: 请全程使用中文回复，代码风格保持简洁" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;resize:none;outline:none;margin-bottom:14px;"></textarea>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
          '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">创建并开始</button>' +
        '</div>'
      );
      dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
      var wsBtn = document.getElementById('wb-new-ws');
      if (wsBtn) {
        wsBtn.onclick = function () {
          var self2 = this;
          WB.showWorkspacePicker(function (path, label) {
            wsPath = path; wsLabel = label;
            var lbl = document.getElementById('wb-new-ws-label');
            if (lbl) lbl.textContent = label;
          });
        };
      }
      dlg.card.querySelector('.wb-dlg-ok').onclick = async function () {
        var title = document.getElementById('wb-new-title').value.trim() || '未命名会话';
        var gh = document.getElementById('wb-new-gh').checked;
        var sys = document.getElementById('wb-new-sys').value.trim();
        var id = await WB.addConv({ title: title, workspace: wsPath, workspaceLabel: wsLabel, github: gh ? true : null, systemPrompt: sys });
        dlg.close();
        WB.showChat(id);
      };
    },

    // ============ GitHub 配置 ============
    showGithubConfigDialog: function () {
      var cfg = this.github.config() || {};
      var dlg = this.overlay(
        '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 18, 'color:#16a34a;') + 'GitHub 连接配置</div>' +
        '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">配置后 Agent 可通过 github_push 工具把工作区文件推送到你的仓库。Token 需具备 repo 权限（Fine-grained token 请勾选 Contents: Read and write）。Token 仅保存在本机。</div>' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">GitHub 用户名</div>' +
        '<input id="wb-gh-user" type="text" value="' + this.esc(cfg.username || '') + '" placeholder="例如: island-glitch" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;outline:none;margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">Personal Access Token</div>' +
        '<input id="wb-gh-token" type="password" value="' + this.esc(cfg.token || '') + '" placeholder="ghp_xxx" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;outline:none;margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">默认仓库（可选，owner/repo 格式）</div>' +
        '<input id="wb-gh-repo" type="text" value="' + this.esc(cfg.repo || '') + '" placeholder="例如: island-glitch/poemnarapk" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;outline:none;margin-bottom:14px;">' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="wb-dlg-clear" style="flex:1;padding:9px;border:1.5px solid #fecaca;background:#fef2f2;border-radius:10px;font-size:12px;font-weight:700;color:#dc2626;cursor:pointer;">清除配置</button>' +
          '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
          '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存</button>' +
        '</div>'
      );
      dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
      dlg.card.querySelector('.wb-dlg-clear').onclick = function () { this.github.clearConfig(); dlg.close(); WB.renderList(); if (typeof showToast === 'function') showToast('GitHub 配置已清除'); };
      dlg.card.querySelector('.wb-dlg-ok').onclick = function () {
        var username = document.getElementById('wb-gh-user').value.trim();
        var token = document.getElementById('wb-gh-token').value.trim();
        var repo = document.getElementById('wb-gh-repo').value.trim();
        if (!username || !token) { if (typeof showToast === 'function') showToast('请填写用户名与 Token'); return; }
        WB.github.saveConfig({ username: username, token: token, repo: repo });
        dlg.close();
        WB.renderList();
        if (typeof showToast === 'function') showToast('GitHub 配置已保存');
      };
    },

    // ============ 工作区选择器（目录树浏览 + 手动路径） ============
    showWorkspacePicker: function (onPick) {
      var self = this;
      var dlg = this.overlay(
        '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 18, 'color:#0e7490;') + '选择工作区文件夹</div>' +
        '<div id="wb-pick-desc" style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;line-height:1.6;">工作区位于手机存储 <b style="color:#0e7490;">Download/workbench</b><br>可用文件管理器直接查看/修改；若未开启「所有文件访问」权限请先在设置中授权。公共存储仅可浏览。</div>' +
        '<div id="wb-pick-breadcrumb" style="font-size:11px;color:#0e7490;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;"></div>' +
        '<div id="wb-pick-list" style="max-height:280px;overflow-y:auto;border:1.5px solid var(--border);border-radius:10px;padding:6px;background:#f8fafc;min-height:80px;"></div>' +
        '<div style="display:flex;gap:6px;margin-top:10px;">' +
          '<input id="wb-pick-path-input" type="text" placeholder="或手动输入相对路径，如: my-project/src" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:11px;outline:none;">' +
          '<button id="wb-pick-path-btn" style="flex-shrink:0;padding:8px 12px;border:1.5px solid #0e7490;background:#ecfeff;border-radius:10px;font-size:11px;font-weight:700;color:#0e7490;cursor:pointer;">绑定路径</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
          '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button>' +
          '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">选择此目录</button>' +
        '</div>'
      );
      var curPath = '.';
      var curLabel = '工作台私有区';
      function render() {
        var bc = document.getElementById('wb-pick-breadcrumb');
        var list = document.getElementById('wb-pick-list');
        if (!bc || !list) return;
        bc.innerHTML = '';
        var segs = curPath === '.' ? [] : curPath.split('/');
        var acc = '';
        var homeBtn = document.createElement('span');
        homeBtn.style.cssText = 'cursor:pointer;font-weight:700;padding:2px 4px;border-radius:4px;';
        homeBtn.textContent = '工作台私有区';
        homeBtn.onclick = function () { curPath = '.'; render(); };
        bc.appendChild(homeBtn);
        segs.forEach(function (seg, idx) {
          acc = acc ? acc + '/' + seg : seg;
          var arrow = document.createElement('span');
          arrow.textContent = ' / ';
          arrow.style.color = '#cbd5e1';
          bc.appendChild(arrow);
          var sp = document.createElement('span');
          sp.textContent = seg;
          sp.style.cssText = 'cursor:pointer;padding:2px 4px;border-radius:4px;';
          sp.onclick = function () { curPath = acc; render(); };
          bc.appendChild(sp);
        });
        list.innerHTML = '<div style="font-size:11px;color:#94a3b8;padding:10px;text-align:center;">加载中...</div>';
        var res = WB.fs.listDir(curPath);
        if (!res.ok) { list.innerHTML = '<div style="font-size:11px;color:#dc2626;padding:10px;">' + WB.esc(res.error || '读取失败') + '</div>'; return; }
        var entries = (res.entries || []).filter(function (en) { return en.type === 'dir'; });
        var files = (res.entries || []).filter(function (en) { return en.type === 'file'; });
        list.innerHTML = '';
        if (curPath !== '.') {
          var up = document.createElement('div');
          up.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px;cursor:pointer;border-radius:8px;font-size:12px;color:#64748b;';
          up.innerHTML = WB.svg('<path d="M5 12h14"/><path d="M12 5l-7 7 7 7"/>', 14) + '返回上级';
          up.onclick = function () { var parts = curPath.split('/'); parts.pop(); curPath = parts.length ? parts.join('/') : '.'; render(); };
          list.appendChild(up);
        }
        entries.forEach(function (en) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px;cursor:pointer;border-radius:8px;font-size:12px;color:var(--text-primary);';
          row.innerHTML = WB.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>', 14, 'color:#f59e0b;') + '<span style="flex:1;">' + WB.esc(en.name) + '</span>' + WB.svg('<path d="M9 18l6-6-6-6"/>', 12, 'color:#cbd5e1;');
          row.onclick = function () { curPath = curPath === '.' ? en.name : curPath + '/' + en.name; render(); };
          list.appendChild(row);
        });
        if (files.length > 0) {
          var fh = document.createElement('div');
          fh.style.cssText = 'font-size:10px;color:#94a3b8;padding:6px 8px 2px;';
          fh.textContent = '文件 (' + files.length + '): ' + files.slice(0, 6).map(function (f) { return f.name; }).join(', ') + (files.length > 6 ? ' ...' : '');
          list.appendChild(fh);
        }
      }
      render();
      var pathBtn = dlg.card.querySelector('#wb-pick-path-btn');
      if (pathBtn) {
        pathBtn.onclick = function () {
          var raw = dlg.card.querySelector('#wb-pick-path-input').value.trim();
          if (!raw) { if (typeof showToast === 'function') showToast('请输入相对路径'); return; }
          var clean = raw.replace(/\\\\/g, '/').replace(/^\.?\//, '');
          dlg.close();
          if (onPick) onPick(clean || '.', '手动路径: ' + clean);
        };
      }
      dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
      dlg.card.querySelector('.wb-dlg-ok').onclick = function () {
        dlg.close();
        if (onPick) onPick(curPath, curLabel + (curPath === '.' ? '' : ' / ' + curPath));
      };
    },

    // ============ 数据清理 ============
    showClearDataDialog: function () {
      var self = this;
      var dlg = this.overlay(
        '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">' + this.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18, 'color:#ef4444;') + '清空工作台数据</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">工作台的对话记录、产物文件与配置说明：</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">' +
          '<button class="wb-clear-opt" data-mode="chat" style="padding:10px;border:1.5px solid var(--border);border-radius:10px;background:#fff;font-size:12px;color:var(--text-primary);cursor:pointer;text-align:left;">' + this.svg('<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4-.86L3 21l1.2-4.6A7.97 7.97 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>', 14, 'color:#6366f1;') + ' 仅清空全部对话记录（保留 GitHub 配置与工作区文件）</button>' +
          '<button class="wb-clear-opt" data-mode="all" style="padding:10px;border:1.5px solid #fecaca;border-radius:10px;background:#fef2f2;font-size:12px;color:#b91c1c;cursor:pointer;text-align:left;">' + this.svg('<path d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>', 14, 'color:#dc2626;') + ' 对话 + GitHub 配置 + 工作区文件 一并清空</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;"><button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">取消</button></div>'
      );
      dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
      dlg.card.querySelectorAll('.wb-clear-opt').forEach(function (btn) {
        btn.onclick = function () {
          var mode = btn.getAttribute('data-mode');
          dlg.close();
          WB.confirmDialog('确认清空', mode === 'all' ? '将清空全部工作台对话，并删除 GitHub 配置与工作区文件。此操作不可恢复，确定继续吗？' : '将清空全部工作台对话记录（保留 GitHub 配置与工作区文件）。确定继续吗？', async function () {
            try {
              await db.wb_conversations.clear();
              await db.wb_messages.clear();
              if (mode === 'all') {
                WB.github.clearConfig();
                if (WB.fs._guard()) WB.fs.del('.');
              }
              if (typeof showToast === 'function') showToast('工作台数据已清空');
              WB.renderList();
            } catch (e) { if (typeof showToast === 'function') showToast('清空失败: ' + e.message); }
          });
        };
      });
    },

    // ============ 工具函数 ============
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    fmtTime: function (ts) {
      try { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); } catch (e) { return ''; }
    },
    fmtDate: function (ts) {
      try { var d = new Date(ts); var now = new Date(); if (d.toDateString() === now.toDateString()) return '今天'; return (d.getMonth() + 1) + '月' + d.getDate() + '日'; } catch (e) { return ''; }
    }
  };

  // ==================== 全局导出 ====================
  window.workbenchSystem = WB;
  window.initWorkbenchApp = function () { WB.init(); };
  window.clearWorkbenchData = function () { if (WB && typeof WB.showClearDataDialog === 'function') WB.showClearDataDialog(); };
})();
// ============================================================
//  Claude 化重设计层（覆盖渲染 + 独立 MCP + Artifacts）
// ============================================================
(function () {
  var WB = window.workbenchSystem;
  if (!WB) return;

  // ---------- 轻量 Markdown 渲染 ----------
  WB.renderMarkdown = function (text) {
    if (!text) return '';
    var s = String(text);
    var out = '';
    var lines = s.split('\n');
    var i = 0;
    var inCode = false;
    var codeLang = '';
    var codeBuf = [];
    var tableRows = [];
    function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function inline(t) {
      var rr = esc(t);
      rr = rr.replace(/\x60([^\x60]+)\x60/g, '<code style="background:#f1f5f9;border-radius:4px;padding:1px 5px;font-size:0.85em;color:#be123c;">$1</code>');
      rr = rr.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      rr = rr.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      return rr;
    }
    function closeTable() {
      if (!tableRows.length) return;
      var head = tableRows[0].split('|').map(function (c) { return c.trim(); }).filter(Boolean);
      var body = tableRows.slice(1);
      var h = "<table style='border-collapse:collapse;width:100%;margin:10px 0;font-size:12px;'><thead><tr>" +
        head.map(function (c) { return "<th style='border:1px solid #e2e8f0;background:#f8fafc;padding:6px 10px;text-align:left;'>" + inline(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        body.map(function (row) {
          var cells = row.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
          return '<tr>' + cells.map(function (c) { return "<td style='border:1px solid #e2e8f0;padding:6px 10px;'>" + inline(c) + '</td>'; }).join('') + '</tr>';
        }).join('') +
        '</tbody></table>';
      out += h;
      tableRows = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      if (/^\x60\x60\x60/.test(trimmed)) {
        if (!inCode) {
          closeTable();
          inCode = true;
          codeLang = trimmed.slice(3).trim() || '';
          codeBuf = [];
        } else {
          var codeHtml = codeBuf.map(function (c) { return esc(c); }).join('\n');
          out += '<div style="margin:10px 0;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;background:#0f172a;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#1e293b;">' +
              '<span style="font-size:10px;color:#64748b;font-family:monospace;">' + esc(codeLang || 'code') + '</span>' +
              '<button class="wb-code-copy" data-code="' + esc(codeBuf.join('\n')) + '" style="border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:10px;display:flex;align-items:center;gap:4px;">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>复制</button>' +
            '</div>' +
            '<pre style="margin:0;padding:12px;overflow-x:auto;font-size:12px;line-height:1.6;color:#e2e8f0;"><code style="font-family:ui-monospace,monospace;">' + codeHtml + '</code></pre>' +
          '</div>';
          inCode = false;
        }
        i++;
        continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }
      if (/^\|/.test(trimmed) && /\|/.test(trimmed.slice(1))) {
        if (line.indexOf('---') >= 0) { i++; continue; }
        tableRows.push(trimmed);
        i++;
        continue;
      }
      closeTable();
      var hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) {
        var lvl = hm[1].length;
        out += '<h' + lvl + ' style="margin:14px 0 6px;font-size:' + (lvl === 1 ? 17 : lvl === 2 ? 15 : 13.5) + 'px;font-weight:700;color:var(--text-primary);">' + inline(hm[2]) + '</h' + lvl + '>';
        i++;
        continue;
      }
      var lm = line.match(/^[-*]\s+(.*)/);
      if (lm) {
        out += '<div style="display:flex;gap:8px;margin:3px 0;font-size:13px;line-height:1.7;color:var(--text-primary);"><span style="color:#94a3b8;">•</span><span style="flex:1;">' + inline(lm[1]) + '</span></div>';
        i++;
        continue;
      }
      var nm = line.match(/^\d+\.\s+(.*)/);
      if (nm) {
        out += '<div style="display:flex;gap:8px;margin:3px 0;font-size:13px;line-height:1.7;color:var(--text-primary);"><span style="color:#94a3b8;min-width:16px;text-align:right;">' + nm[0].split('.')[0] + '.</span><span style="flex:1;">' + inline(nm[1]) + '</span></div>';
        i++;
        continue;
      }
      if (!trimmed) { out += '<div style="height:8px;"></div>'; i++; continue; }
      out += '<p style="margin:4px 0;font-size:13px;line-height:1.75;color:var(--text-primary);word-break:break-word;">' + inline(line) + '</p>';
      i++;
    }
    closeTable();
    return out;
  };

  // ---------- 工作台独立 MCP 配置 ----------
  WB.wbMCP = {
    list: async function () { try { return (await db.wb_mcp_servers.orderBy('updatedAt').reverse().toArray()) || []; } catch (e) { return []; } },
    save: async function (data) {
      if (data.id) { await db.wb_mcp_servers.update(Number(data.id), data); return data.id; }
      return await db.wb_mcp_servers.add(Object.assign({ group: '默认', type: 'streamable_http', enabled: true, tools: [], updatedAt: Date.now() }, data));
    },
    remove: async function (id) { await db.wb_mcp_servers.delete(Number(id)); },
    rpc: async function (server, method, params) {
      var url = String(server.url || '').replace(/\/+$/, '');
      var headers = Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, server.headers || {});
      var res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params || {} }) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + String(await res.text()).slice(0, 200));
      var data = await res.json();
      if (data.error) throw new Error(data.error.message || 'JSON-RPC 错误 ' + data.error.code);
      return data.result;
    },
    fetchTools: async function (server) {
      try { await this.rpc(server, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'StoryPhoneWorkbench', version: '1.0' } }); } catch (e) {}
      var result = await this.rpc(server, 'tools/list', {});
      return (result && Array.isArray(result.tools)) ? result.tools : [];
    },
    callTool: async function (server, toolName, args) {
      var result = await this.rpc(server, 'tools/call', { name: toolName, arguments: args || {} });
      if (result && Array.isArray(result.content)) {
        var texts = result.content.map(function (c) { return (c && (c.text || JSON.stringify(c))) || ''; }).join('\n');
        return { ok: true, result: texts };
      }
      return { ok: true, result: JSON.stringify(result) };
    },
    promptTools: async function () {
      var servers = await this.list();
      var out = [];
      for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        if (!s.enabled) continue;
        var tools = s.tools || [];
        for (var j = 0; j < tools.length; j++) {
          var t = tools[j];
          if (t.enabled !== false) out.push({ server: s.name, tool: t.name, description: t.description || '' });
        }
      }
      return out;
    }
  };
  WB.tools.mcp_tool = async function (args) {
    var servers = await WB.wbMCP.list();
    var srv = null;
    for (var i = 0; i < servers.length; i++) {
      if (servers[i].name === args.server && servers[i].enabled) { srv = servers[i]; break; }
    }
    if (!srv) return { ok: false, error: '工作台未找到已启用的 MCP 服务器: ' + (args.server || '') + '（请先在工作台设置-MCP 中配置并启用）' };
    try { return await WB.wbMCP.callTool(srv, args.tool, args.arguments || {}); }
    catch (e) { return { ok: false, error: 'MCP 调用失败: ' + e.message }; }
  };
  WB.tools.mcp_servers = async function () {
    var servers = await WB.wbMCP.list();
    return { ok: true, servers: servers.map(function (s) { return { name: s.name, enabled: s.enabled, tools: (s.tools || []).filter(function (t) { return t.enabled !== false; }).map(function (t) { return t.name; }) }; }) };
  };

  // ---------- Artifacts ----------
  WB.artifacts = {
    items: [],
    activeIndex: -1,
    panelOpen: false,
    viewMode: 'code',
    push: function (lang, code) {
      var item = { id: Date.now() + Math.random(), title: 'output.' + (lang || 'txt'), lang: lang || '', code: code, ts: Date.now() };
      this.items.push(item);
      this.activeIndex = this.items.length - 1;
      return this.items.length - 1; // 返回索引（调用处 data-idx 需要数字索引）
    },
    open: function (idx) { this.activeIndex = idx; this.panelOpen = true; this.viewMode = 'code'; this.renderPanel(); },
    close: function () { this.panelOpen = false; this.renderPanel(); },
    toggleView: function (mode) { this.viewMode = mode; this.renderPanel(); },
    renderPanel: function () {
      var panel = document.getElementById('wb-artifacts-panel');
      if (!panel) return;
      if (!this.panelOpen) { panel.style.display = 'none'; return; }
      var self = this;
      var item = this.items[this.activeIndex];
      if (!item) return;
      panel.style.display = 'flex';
      var canPreview = item.lang === 'html' || item.lang === 'svg';
      var viewSwitch = canPreview
        ? '<div style="display:flex;background:#f1f5f9;border-radius:8px;padding:2px;">' +
            '<button class="wb-art-view" data-mode="code" style="border:none;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;' + (this.viewMode === 'code' ? 'background:#fff;color:var(--text-primary);box-shadow:0 1px 3px rgba(0,0,0,0.08);' : 'background:transparent;color:#64748b;') + '">Code</button>' +
            '<button class="wb-art-view" data-mode="preview" style="border:none;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;' + (this.viewMode === 'preview' ? 'background:#fff;color:var(--text-primary);box-shadow:0 1px 3px rgba(0,0,0,0.08);' : 'background:transparent;color:#64748b;') + '">Preview</button>' +
          '</div>'
        : '';
      panel.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
          '<span style="font-size:13px;font-weight:700;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + WB.esc(item.title) + '</span>' +
          viewSwitch +
          '<button class="wb-art-close" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:4px;">' + WB.svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 15) + '</button>' +
        '</div>' +
        '<div class="wb-art-body" style="flex:1;overflow:auto;background:#0f172a;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:#e2e8f0;padding:12px;white-space:pre-wrap;word-break:break-word;"></div>';
      var body = panel.querySelector('.wb-art-body');
      if (this.viewMode === 'preview' && canPreview) {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
        iframe.sandbox = 'allow-scripts allow-same-origin';
        iframe.srcdoc = item.code;
        body.style.cssText = 'flex:1;overflow:auto;background:#fff;padding:0;';
        body.innerHTML = '';
        body.appendChild(iframe);
      } else {
        body.textContent = item.code;
      }
      panel.querySelectorAll('.wb-art-view').forEach(function (b) {
        b.onclick = function () { self.toggleView(b.getAttribute('data-mode')); };
      });
      var close = panel.querySelector('.wb-art-close');
      if (close) close.onclick = function () { self.close(); };
    }
  };


  // ============ Claude 化渲染：主框架 + 侧边栏 + 空态 ============
  WB._shellBuilt = false;
  WB._sidebarOpen = false;
  WB.toggleSidebar = function (force) {
    var sb = document.getElementById('wb-sidebar');
    var mask = document.getElementById('wb-sidebar-mask');
    if (!sb) return;
    this._sidebarOpen = (force !== undefined) ? force : !this._sidebarOpen;
    sb.style.transform = this._sidebarOpen ? 'translateX(0)' : 'translateX(-100%)';
    if (mask) mask.style.display = this._sidebarOpen ? 'block' : 'none';
  },
  WB.timeGroup = function (ts) {
    var d = new Date(ts);
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startToday) return '今天 Today';
    if (ts >= startToday - 86400000) return '昨天 Yesterday';
    if (ts >= startToday - 7 * 86400000) return '最近 7 天 Previous 7 days';
    return '更早 Earlier';
  },
  WB.renderList = function () {
    var self = this;
    this.state.view = 'list';
    this.state.activeConvId = null;
    var body = document.getElementById('wb-body');
    if (!body) return;
    this.convs().then(function (convs) {
      body.innerHTML =
        '<div id="wb-shell" style="position:absolute;inset:0;display:flex;overflow:hidden;background:#fff;">' +
          '<div id="wb-sidebar-mask" style="position:fixed;inset:0;background:rgba(15,23,42,0.4);z-index:99990;display:none;"></div>' +
          '<aside id="wb-sidebar" style="position:fixed;top:0;left:0;bottom:0;width:252px;background:#faf9f7;z-index:99991;transform:translateX(-100%);transition:transform .25s ease;display:flex;flex-direction:column;box-shadow:2px 0 24px rgba(0,0,0,0.1);">' +
            '<div style="padding:14px 12px 8px;display:flex;align-items:center;gap:8px;">' +
              '<button class="wb-side-collapse" style="border:none;background:none;color:#64748b;cursor:pointer;padding:6px;">' + self.svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>', 17) + '</button>' +
              '<div style="flex:1;"></div>' +
              '<button class="wb-gh-quick" title="GitHub 连接" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:6px;">' + self.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 16) + '</button>' +
            '</div>' +
            '<div style="padding:0 10px 10px;">' +
              '<button class="wb-new-chat" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border:1px solid #e2e8f0;border-radius:999px;background:#fff;font-size:13px;font-weight:700;color:#c2410c;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.04);">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8m0 0 4-4m-4 4-4-4"/><path d="M12 10v12"/><path d="M20 15a8 8 0 0 1-16 0"/></svg>开启新对话</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:0 8px 8px;" id="wb-side-records"></div>' +
            '<div style="padding:10px;border-top:1px solid #ece8e3;">' +
              '<button class="wb-user-pill" style="width:100%;display:flex;align-items:center;gap:10px;padding:8px;border:none;background:transparent;border-radius:10px;cursor:pointer;">' +
                '<span style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#c2410c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">叙</span>' +
                '<span style="flex:1;text-align:left;"><span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">叙事诗小手机</span><span style="display:block;font-size:10px;color:#94a3b8;">工作台 Agent</span></span>' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
              '</button>' +
            '</div>' +
          '</aside>' +
          '<main id="wb-main" style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative;"></main>' +
        '</div>' +
        '<div id="wb-artifacts-panel" style="position:fixed;top:0;right:0;bottom:0;width:88%;max-width:520px;background:#fff;z-index:99992;display:none;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,0.14);"></div>';
      self.renderSidebar(convs);
      self.renderLanding();
      document.querySelector('.wb-side-collapse').onclick = function () { self.toggleSidebar(false); };
      document.getElementById('wb-sidebar-mask').onclick = function () { self.toggleSidebar(false); };
      document.querySelector('.wb-new-chat').onclick = function () { self.toggleSidebar(false); self.showNewConvDialog(); };
      document.querySelector('.wb-gh-quick').onclick = function () { self.showGithubConfigDialog(); };
      document.querySelector('.wb-user-pill').onclick = function () { self.showWbSettings(); };
      var main = document.getElementById('wb-main');
      main.addEventListener('click', function (ev) {
        var cp = ev.target.closest('.wb-code-copy');
        if (cp) {
          var code = cp.getAttribute('data-code') || '';
          var done = function () { cp.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>已复制'; };
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(done); }
          else { try { var ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) {} }
        }
        var art = ev.target.closest('.wb-art-open');
        if (art) {
          var idx = Number(art.getAttribute('data-idx'));
          if (!isNaN(idx) && self.artifacts.items[idx]) self.artifacts.open(idx);
        }
      });
    });
  };
  WB.renderSidebar = function (convs) {
    var self = this;
    var wrap = document.getElementById('wb-side-records');
    if (!wrap) return;
    var groups = {};
    convs.forEach(function (c) {
      var g = self.timeGroup(c.updatedAt);
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });
    var order = ['今天 Today', '昨天 Yesterday', '最近 7 天 Previous 7 days', '更早 Earlier'];
    var html = '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:#94a3b8;padding:8px 10px 4px;">PROJECTS</div>';
    order.forEach(function (g) {
      if (!groups[g] || groups[g].length === 0) return;
      html += '<div style="font-size:10px;font-weight:600;letter-spacing:0.5px;color:#94a3b8;padding:10px 10px 4px;">' + g + '</div>';
      groups[g].forEach(function (c) {
        html += '<div class="wb-side-item" data-id="' + c.id + '" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:12px;color:var(--text-primary);">' +
          self.svg('<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4-.86L3 21l1.2-4.6A7.97 7.97 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>', 13, 'color:#cbd5e1;') +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.esc(c.title) + '</span>' +
          (c.github ? '<span style="width:6px;height:6px;border-radius:50%;background:#16a34a;flex-shrink:0;"></span>' : '') +
          '<button class="wb-side-del" data-id="' + c.id + '" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:2px;opacity:0;">' + self.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 13) + '</button>' +
        '</div>';
      });
    });
    if (convs.length === 0) html += '<div style="font-size:11px;color:#94a3b8;padding:20px 12px;text-align:center;line-height:1.7;">还没有历史会话<br>点击上方开启新对话</div>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.wb-side-item').forEach(function (el) {
      el.addEventListener('mouseenter', function () { el.style.background = '#f1ede9'; var d = el.querySelector('.wb-side-del'); if (d) d.style.opacity = '1'; });
      el.addEventListener('mouseleave', function () { el.style.background = 'transparent'; var d = el.querySelector('.wb-side-del'); if (d) d.style.opacity = '0'; });
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.wb-side-del')) return;
        self.toggleSidebar(false);
        self.showChat(Number(el.getAttribute('data-id')));
      });
    });
    wrap.querySelectorAll('.wb-side-del').forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.stopPropagation();
        var id = Number(btn.getAttribute('data-id'));
        self.confirmDialog('删除会话', '确定删除该会话及全部记录吗？', function () { self.delConv(id).then(function () { self.renderList(); }); });
      };
    });
  };
  WB.renderLanding = function () {
    var self = this;
    var main = document.getElementById('wb-main');
    if (!main) return;
    var hour = new Date().getHours();
    var greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    var suggestions = [
      '在工作区创建一个项目并写入示例代码',
      '把一段文本整理成规范的 Markdown 文档',
      '写一个 HTML 天气卡片并在预览中打开'
    ];
    main.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;">' +
        '<button class="wb-menu-btn" style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:7px;cursor:pointer;color:#475569;">' + self.svg('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>', 17) + '</button>' +
        '<div style="flex:1;"></div>' +
        '<span style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px;">' + self.svg('<path d="m7 8 3 3-3 3"/><path d="M12 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/>', 12) + '工作台</span>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 20px;overflow-y:auto;">' +
        '<div style="font-size:26px;font-weight:400;color:var(--text-primary);font-family:Georgia,"Times New Roman",serif;letter-spacing:0.5px;margin-bottom:24px;">' + greet + '，我是你的工作台助手</div>' +
        '<div style="width:100%;max-width:560px;background:#fff;border:1.5px solid #e2e8f0;border-radius:20px;padding:14px;box-shadow:0 8px 30px rgba(15,23,42,0.06);">' +
          '<textarea id="wb-land-input" rows="3" placeholder="描述你想完成的任务..." style="width:100%;box-sizing:border-box;border:none;outline:none;resize:none;font-size:15px;line-height:1.6;color:var(--text-primary);background:transparent;"></textarea>' +
          '<div style="display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid #f1f5f9;">' +
            '<span style="flex:1;"></span>' +
            '<button id="wb-land-send" style="width:38px;height:38px;border-radius:50%;border:none;background:#d97706;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + self.svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 17) + '</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:16px;max-width:560px;">' +
          suggestions.map(function (s, idx) {
            return '<button class="wb-sug" data-idx="' + idx + '" style="border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:8px 14px;font-size:11px;color:#64748b;cursor:pointer;">' + self.esc(s) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    document.querySelector('.wb-menu-btn').onclick = function () { self.toggleSidebar(true); };
    document.getElementById('wb-land-send').onclick = function () { self._landSend(); };
    document.getElementById('wb-land-input').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); self._landSend(); } });
    main.querySelectorAll('.wb-sug').forEach(function (b) {
      b.onclick = function () {
        var input = document.getElementById('wb-land-input');
        if (input) input.value = suggestions[Number(b.getAttribute('data-idx'))];
        input.focus();
      };
    });
  };
  WB._landSend = function () {
    var input = document.getElementById('wb-land-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    var self = this;
    this.addConv({ title: text.slice(0, 18) + (text.length > 18 ? '...' : '') }).then(function (id) {
      self.showChat(id).then(function () {
        var chatInput = document.getElementById('wb-input');
        if (chatInput) chatInput.value = text;
        self.onSendChat();
      });
    });
  };

  // ============ 对话页（Claude 风格） ============
  WB.showChat = function (convId) {
    var self = this;
    return this.getConv(convId).then(function (conv) {
      if (!conv) return null;
      self.state.view = 'chat';
      self.state.activeConvId = conv.id;
      return self.msgs(conv.id).then(function (msgs) {
        self.renderChat(conv, msgs);
        return conv;
      });
    });
  };
  WB.renderChat = function (conv, msgs) {
    var self = this;
    var main = document.getElementById('wb-main');
    if (!main) return;
    var ghDot = conv.github ? '<span title="GitHub" style="width:7px;height:7px;border-radius:50%;background:#16a34a;flex-shrink:0;"></span>' : '';
    var wsTxt = conv.workspaceLabel || '工作台私有区';
    var wsLabel = wsTxt;
    try {
      if (window.AndroidMCP && typeof window.AndroidMCP.wbIsPublicWorkspace === 'function' && !window.AndroidMCP.wbIsPublicWorkspace()) {
        wsLabel = wsTxt + ' ⚠未授权';
      }
    } catch (e) {}
    main.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #f1f5f9;">' +
        '<button class="wb-menu-btn" style="border:none;background:none;color:#475569;cursor:pointer;padding:4px;">' + this.svg('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>', 18) + '</button>' +
        '<span style="font-size:13px;font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%;">' + this.esc(conv.title) + '</span>' +
        ghDot +
        '<span id="wb-ws-label" style="font-size:9px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:26%;cursor:pointer;">' + this.esc(wsLabel) + '</span>' +
        '<span style="flex:1;"></span>' +
        '<span id="wb-usage" style="font-size:9px;color:#94a3b8;">' + (self._usageText ? self._usageText(conv) : ('↑' + (conv.totalTokensIn || 0) + ' ↓' + (conv.totalTokensOut || 0))) + '</span>' +
        '<button id="wb-conv-menu" style="border:none;background:none;color:#64748b;cursor:pointer;padding:4px;">' + this.svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', 16) + '</button>' +
      '</div>' +
      '<div id="wb-msgs" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;margin:0 auto;box-sizing:border-box;"></div>' +
      '<div style="flex-shrink:0;padding:8px 12px 12px;background:linear-gradient(180deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.92) 28%);">' +
        '<div style="max-width:760px;margin:0 auto;background:#fff;border:1.5px solid #e2e8f0;border-radius:18px;padding:10px 12px;box-shadow:0 4px 20px rgba(15,23,42,0.08);">' +
          '<textarea id="wb-input" rows="2" placeholder="Reply to 工作台 Agent..." style="width:100%;box-sizing:border-box;border:none;outline:none;resize:none;font-size:14px;line-height:1.6;color:var(--text-primary);background:transparent;max-height:120px;"></textarea>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">' +
            '<button id="wb-model-pill" style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:999px;padding:4px 10px;font-size:10px;font-weight:600;color:#64748b;cursor:pointer;display:flex;align-items:center;gap:4px;">模型 ⌄</button>' +
            '<span style="flex:1;"></span>' +
            '<button id="wb-stop-btn" style="display:none;width:36px;height:36px;border-radius:50%;border:none;background:#ef4444;color:#fff;cursor:pointer;align-items:center;justify-content:center;">' + this.svg('<rect x="6" y="6" width="12" height="12" rx="2"/>', 14) + '</button>' +
            '<button id="wb-send-btn" style="width:36px;height:36px;border-radius:50%;border:none;background:#d97706;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + this.svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 16) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var msgsEl = document.getElementById('wb-msgs');
    msgs.forEach(function (m) { self.renderStoredMsg(msgsEl, m); });
    this.scrollToBottom();
    this.refreshModelPill();
    main.querySelector('.wb-menu-btn').onclick = function () { self.toggleSidebar(true); };
    document.getElementById('wb-send-btn').onclick = function () { self.onSendChat(); };
    document.getElementById('wb-stop-btn').onclick = function () { self.stopAgent(); };
    document.getElementById('wb-input').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); self.onSendChat(); } });
    document.getElementById('wb-input').addEventListener('input', function () { self._resizeInput(); });
    document.getElementById('wb-model-pill').onclick = function () { self.showModelPicker(); };
    document.getElementById('wb-conv-menu').onclick = function () { self.showConvMenu(conv); };
    var wsLabelEl = document.getElementById('wb-ws-label');
    if (wsLabelEl) wsLabelEl.onclick = function () { self.ensurePublicWorkspace(); };
    if (this.state.sending) {
      document.getElementById('wb-send-btn').style.display = 'none';
      document.getElementById('wb-stop-btn').style.display = 'flex';
    }
    document.getElementById('wb-input').focus();
  };
  WB._resizeInput = function () {
    var el = document.getElementById('wb-input');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };
  WB.onSendChat = function () {
    var input = document.getElementById('wb-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text || this.state.sending) return;
    input.value = '';
    this._resizeInput();
    var self = this;
    this.getConv(this.state.activeConvId).then(function (conv) {
      if (conv) self.runAgent(conv, text);
    });
  };
  WB.refreshModelPill = function () {
    var pill = document.getElementById('wb-model-pill');
    if (!pill) return;
    var self = this;
    this.getApiPreset().then(function (p) {
      if (pill) pill.innerHTML = self.svg('<path d="M12 2v8m0 0 4-4m-4 4-4-4"/><path d="M12 10v12"/><path d="M20 15a8 8 0 0 1-16 0"/>', 11, 'color:#d97706;') + '<span>' + self.esc((p && p.name) || '未配置') + '</span>' + self.svg('<path d="m6 9 6 6 6-6"/>', 10);
    });
  };
  WB.showModelPicker = function () {
    var self = this;
    this.getApiPreset().then(function (current) {
      db.api_presets.toArray().then(function (presets) {
        if (presets.length === 0) { self.alert('未配置 API', '请先在 设置-API 服务 中配置并启用一个模型服务。'); return; }
        var dlg = self.overlay(
          '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + self.svg('<path d="M12 2v8m0 0 4-4m-4 4-4-4"/><path d="M12 10v12"/><path d="M20 15a8 8 0 0 1-16 0"/>', 18, 'color:#d97706;') + '选择模型</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">' +
            presets.map(function (p) {
              var active = current && current.name === p.name;
              var disabled = p.enabled === false;
              var style = 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (active ? '#d97706' : (disabled ? '#fecaca' : 'var(--border)')) + ';border-radius:12px;background:' + (active ? '#fff7ed' : (disabled ? '#fef2f2' : '#fff')) + ';cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';text-align:left;';
              return '<button class="wb-model-opt" data-name="' + self.esc(p.name) + '" data-enabled="' + (p.enabled !== false) + '" style="' + style + '">' +
                '<span style="flex:1;"><span style="display:block;font-size:13px;font-weight:700;color:' + (disabled ? '#b91c1c' : 'var(--text-primary)') + ';">' + self.esc(p.name || '未命名') + '</span>' +
                '<span style="display:block;font-size:10px;color:#94a3b8;">' + self.esc(p.model || '') + (disabled ? ' (已禁用，请先在设置中启用)' : '') + '</span></span>' +
                (active ? self.svg('<path d="M20 6 9 17l-5-5"/>', 16, 'color:#d97706;') : '') +
              '</button>';
            }).join('') +
          '</div>'
        );
        dlg.card.querySelectorAll('.wb-model-opt').forEach(function (b) {
          b.onclick = function () {
            if (b.getAttribute('data-enabled') !== 'true') {
              if (typeof showToast === 'function') showToast('该模型服务已被禁用，请先在 设置-API 服务 中启用');
              return;
            }
            localStorage.setItem('wb_model_name', b.getAttribute('data-name'));
            dlg.close();
            self.refreshModelPill();
          };
        });
      });
    });
  };
  WB.getApiPreset = async function () {
    try {
      // 专用页签若为「工作台」指定了预设，优先用它；否则沿用工作台自己的模型选择
      if (window.apiRoutes && typeof window.apiRoutes.getFeatureId === "function" && window.apiRoutes.getFeatureId("workbench") > 0) {
        var own = await window.apiRoutes.resolve("workbench");
        if (own) return own;
      }
      var presets = await db.api_presets.toArray();
      if (!presets.length) return null;
      var name = localStorage.getItem('wb_model_name');
      var found = null;
      for (var i = 0; i < presets.length; i++) { if (presets[i].name === name) { found = presets[i]; break; } }
      // 选中的模型若被禁用：优先回退到已启用的模型（显示与实际一致，避免"显示已禁用却仍在用"的矛盾）
      if (found && found.enabled !== false) return found;
      var enabled = presets.find(function (p) { return p.enabled !== false; });
      if (enabled) {
        // 修正本地选中项指向实际使用的模型
        try { localStorage.setItem('wb_model_name', enabled.name); } catch (e) {}
        return enabled;
      }
      return found || presets[0];
    } catch (e) { return null; }
  };
  WB.renderAssistantContent = function (full, container) {
    var self = this;
    var thinks = String(full || '').match(/<think>([\s\S]*?)<\/think>/g) || [];
    var cleaned = String(full || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    var html = '';
    thinks.forEach(function (t) {
      var inner = t.replace(/<\/?think>/g, '').trim();
      html += '<div style="margin:6px 0;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:8px 12px;">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:#64748b;">' +
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>思考过程</div>' +
        '<div style="font-size:11px;color:#64748b;line-height:1.6;margin-top:4px;white-space:pre-wrap;">' + self.esc(inner.slice(0, 400)) + (inner.length > 400 ? '...' : '') + '</div>' +
      '</div>';
    });
    container.innerHTML = html + self.renderMarkdown(cleaned);
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
  WB.appendBubble = function (role, text) {
    var self = this;
    var el = document.getElementById('wb-msgs');
    if (!el) return null;
    if (role === 'user') {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'align-self:flex-end;background:#f4f1ec;color:#1c1917;border-radius:16px 16px 4px 16px;padding:10px 14px;max-width:84%;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;';
      wrap.textContent = text || '';
      el.appendChild(wrap);
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
    content.textContent = text || '';
    wrap2.appendChild(head);
    wrap2.appendChild(content);
    el.appendChild(wrap2);
    this.scrollToBottom();
    return {
      _el: content,
      _finalize: function (full) {
        self.renderAssistantContent(full, content);
        self.scrollToBottom();
      }
    };
  };
  WB.renderStoredMsg = function (container, m) {
    var self = this;
    if (m.role === 'user') {
      this.appendBubble('user', m.content);
    } else if (m.role === 'assistant') {
      var bubble = this.appendBubble('assistant', '');
      if (bubble && bubble._finalize) bubble._finalize(m.content);
    } else if (m.role === 'tool') {
      var div = document.createElement('div');
      div.style.cssText = 'align-self:flex-start;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:10px;padding:8px 10px;font-size:10px;color:#64748b;max-width:88%;word-break:break-all;';
      div.textContent = '[工具结果] ' + String(m.content || '').slice(0, 300) + (m.content && m.content.length > 300 ? '...' : '');
      container.appendChild(div);
    } else {
      var sys = document.createElement('div');
      sys.style.cssText = 'align-self:center;font-size:10px;color:#94a3b8;background:#f8fafc;border-radius:8px;padding:4px 10px;max-width:80%;';
      sys.textContent = m.content;
      container.appendChild(sys);
    }
  };
  WB.appendToolCard = function (tool, args) {
    var self = this;
    var el = document.getElementById('wb-msgs');
    var card = document.createElement('div');
    card.style.cssText = 'align-self:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px;width:88%;box-sizing:border-box;';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#334155;">' + this.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 13, 'color:#6366f1;') + '工具: ' + this.esc(tool) +
        '<span style="margin-left:auto;font-weight:400;color:#94a3b8;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%;">' + this.esc(JSON.stringify(args || {}).slice(0, 60)) + '</span></div>' +
      '<div class="wb-tool-result" style="margin-top:6px;font-size:10px;color:#475569;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;">运行中...</div>';
    el.appendChild(card);
    this.scrollToBottom();
    return {
      _render: function (result) {
        var box = card.querySelector('.wb-tool-result');
        if (!box) return;
        if (result && result.ok) {
          box.style.color = '#15803d';
          if (result.entries && Array.isArray(result.entries)) box.textContent = '共 ' + result.entries.length + ' 项: ' + result.entries.map(function (en) { return en.name + (en.type === 'dir' ? '/' : ''); }).join(', ').slice(0, 500);
          else if (result.result !== undefined) box.textContent = String(result.result).slice(0, 2000);
          else if (result.content !== undefined) box.textContent = String(result.content).slice(0, 2000);
          else box.textContent = result.message || '执行完成';
        } else {
          box.style.color = '#dc2626';
          box.textContent = '失败: ' + ((result && result.error) || '未知错误');
        }
      }
    };
  };
  WB.appendSysMsg = function (text) {
    var el = document.getElementById('wb-msgs');
    if (!el) return;
    var div = document.createElement('div');
    div.style.cssText = 'align-self:center;font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:5px 12px;max-width:85%;';
    div.textContent = text;
    el.appendChild(div);
    this.scrollToBottom();
  };
  WB.scrollToBottom = function () {
    var el = document.getElementById('wb-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  };
  WB.updateChatHeader = function (conv) {
    var usageEl = document.getElementById('wb-usage');
    if (usageEl) usageEl.textContent = '↑' + (conv.totalTokensIn || 0) + ' ↓' + (conv.totalTokensOut || 0) + (conv.cacheHits ? ' 缓存:' + conv.cacheHits : '');
  };
  // ============ 系统提示词覆盖（工作台 MCP + 自定义指令） ============
  WB._origBuildSystemPrompt = WB.buildSystemPrompt;
  WB.buildSystemPrompt = function (conv) {
    var base = this._origBuildSystemPrompt ? this._origBuildSystemPrompt(conv) : '';
    var lines = [];
    // 工作台 MCP 工具（独立配置）
    var mcpCache = null;
    try { mcpCache = JSON.parse(localStorage.getItem('wb_mcp_prompt_tools')) || []; } catch (e) { mcpCache = []; }
    if (mcpCache && mcpCache.length) {
      lines.push('');
      lines.push('【工作台 MCP 工具（独立配置，通过 mcp_tool 调用）】');
      mcpCache.forEach(function (t) { lines.push('- mcp_tool 参数 {server:"' + t.server + '", tool:"' + t.tool + '", arguments:{...}}：' + (t.description || '无描述')); });
      lines.push('调用示例: [WB_TOOL:{"tool":"mcp_tool","arguments":{"server":"' + mcpCache[0].server + '","tool":"' + mcpCache[0].tool + '","arguments":{}}}]');
    }
    // 全局自定义指令
    var custom = '';
    try { custom = localStorage.getItem('wb_custom_instructions') || ''; } catch (e) {}
    if (custom && custom.trim()) {
      lines.push('');
      lines.push('【用户全局自定义指令】');
      lines.push(custom.trim());
    }
    return base + lines.join('\n');
  };

  // ============ 工作台设置弹窗 ============
  WB.showWbSettings = function () {
    var self = this;
    var cfg = this.github.config();
    var custom = '';
    try { custom = localStorage.getItem('wb_custom_instructions') || ''; } catch (e) {}
    var dlg = this.overlay(
      '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:14px;">' + this.svg('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 17, 'color:#64748b;') + '工作台设置</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<button class="wb-set-gh" style="display:flex;align-items:center;gap:10px;padding:11px 12px;border:1.5px solid var(--border);border-radius:12px;background:#fff;cursor:pointer;text-align:left;">' +
          this.svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>', 17, 'color:#16a34a;') +
          '<span style="flex:1;"><span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">GitHub 连接</span><span style="display:block;font-size:10px;color:#94a3b8;">' + (cfg ? ('已连接: ' + (cfg.username || '')) : '未连接（配置用户名与 Token）') + '</span></span>' +
          this.svg('<path d="M9 18l6-6-6-6"/>', 14, 'color:#cbd5e1;') +
        '</button>' +
        '<button class="wb-set-mcp" style="display:flex;align-items:center;gap:10px;padding:11px 12px;border:1.5px solid var(--border);border-radius:12px;background:#fff;cursor:pointer;text-align:left;">' +
          this.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 17, 'color:#6366f1;') +
          '<span style="flex:1;"><span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">MCP 服务器</span><span style="display:block;font-size:10px;color:#94a3b8;">工作台独立配置，Agent 可直接调用</span></span>' +
          this.svg('<path d="M9 18l6-6-6-6"/>', 14, 'color:#cbd5e1;') +
        '</button>' +
        '<div style="border:1.5px solid var(--border);border-radius:12px;padding:11px 12px;background:#fff;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">全局自定义指令</div>' +
          '<textarea id="wb-custom-inst" rows="2" placeholder="你希望 Agent 了解你的哪些背景信息 / 采用什么回复风格？" style="width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:11px;resize:none;outline:none;">' + self.esc(custom) + '</textarea>' +
        '</div>' +
        '<button class="wb-set-clear" style="display:flex;align-items:center;gap:10px;padding:11px 12px;border:1.5px solid #fecaca;border-radius:12px;background:#fef2f2;cursor:pointer;text-align:left;">' +
          this.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 16, 'color:#dc2626;') +
          '<span style="flex:1;font-size:12px;font-weight:700;color:#b91c1c;">清空工作台数据</span>' +
        '</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">关闭</button>' +
        '<button class="wb-dlg-ok" style="flex:1;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">保存指令</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-set-gh').onclick = function () { dlg.close(); self.showGithubConfigDialog(); };
    dlg.card.querySelector('.wb-set-mcp').onclick = function () { dlg.close(); self.showMcpConfigDialog(); };
    dlg.card.querySelector('.wb-set-clear').onclick = function () { dlg.close(); self.showClearDataDialog(); };
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('.wb-dlg-ok').onclick = function () {
      var v = dlg.card.querySelector('#wb-custom-inst').value;
      try { localStorage.setItem('wb_custom_instructions', v); } catch (e) {}
      dlg.close();
      if (typeof showToast === 'function') showToast('自定义指令已保存');
    };
  };

  // ============ 工作台 MCP 服务器配置 ============
  WB.showMcpConfigDialog = function () {
    var self = this;
    var dlg = this.overlay(
      '<div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + this.svg('<path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>', 17, 'color:#6366f1;') + '工作台 MCP 服务器</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">工作台独立维护的 MCP 服务器配置（不依赖原有 MCP 面板）。配置后 Agent 可通过 mcp_tool 直接调用其工具。</div>' +
      '<div id="wb-mcp-list" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;margin-bottom:10px;">加载中...</div>' +
      '<button id="wb-mcp-add" style="width:100%;padding:9px;border:1.5px dashed #6366f1;border-radius:10px;background:#eef2ff;font-size:12px;font-weight:700;color:#4338ca;cursor:pointer;">+ 添加 MCP 服务器</button>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="wb-dlg-cancel" style="flex:1;padding:9px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;">关闭</button>' +
      '</div>'
    );
    dlg.card.querySelector('.wb-dlg-cancel').onclick = function () { dlg.close(); };
    dlg.card.querySelector('#wb-mcp-add').onclick = function () { self.showMcpEditDialog(null, dlg); };
    self._renderMcpList(dlg);
  };

  WB._renderMcpList = function (dlg) {
    var self = this;
    var wrap = dlg.card.querySelector('#wb-mcp-list');
    if (!wrap) return;
    this.wbMCP.list().then(function (servers) {
      if (!servers.length) { wrap.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:20px 0;">尚未配置 MCP 服务器，点击下方添加</div>'; return; }
      wrap.innerHTML = servers.map(function (s) {
        var toolCount = (s.tools || []).filter(function (t) { return t.enabled !== false; }).length;
        return '<div style="border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="flex:1;font-size:12px;font-weight:700;color:var(--text-primary);">' + self.esc(s.name) + '</span>' +
            '<span style="font-size:9px;color:#94a3b8;background:#f1f5f9;border-radius:6px;padding:2px 6px;">' + toolCount + ' 工具</span>' +
            '<button class="wb-mcp-toggle" data-id="' + s.id + '" style="border:none;background:none;cursor:pointer;color:' + (s.enabled ? '#16a34a' : '#94a3b8') + ';padding:2px;">' + (s.enabled ? self.svg('<path d="M20 6 9 17l-5-5"/>', 15) : self.svg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>', 15)) + '</button>' +
            '<button class="wb-mcp-edit" data-id="' + s.id + '" style="border:none;background:none;color:#64748b;cursor:pointer;padding:2px;">' + self.svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', 14) + '</button>' +
            '<button class="wb-mcp-del" data-id="' + s.id + '" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:2px;">' + self.svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14) + '</button>' +
          '</div>' +
          '<div style="font-size:9px;color:#94a3b8;margin-top:4px;word-break:break-all;">' + self.esc(s.url || '') + '</div>' +
        '</div>';
      }).join('');
      wrap.querySelectorAll('.wb-mcp-toggle').forEach(function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute('data-id'));
          self.wbMCP.list().then(function (servers) {
            var s = servers.find(function (x) { return x.id === id; });
            if (s) { self.wbMCP.save(Object.assign({}, s, { enabled: !s.enabled })).then(function () { self._renderMcpList(dlg); }); }
          });
        };
      });
      wrap.querySelectorAll('.wb-mcp-edit').forEach(function (b) {
        b.onclick = function () { self.wbMCP.list().then(function (servers) { var s = servers.find(function (x) { return x.id === Number(b.getAttribute('data-id')); }); if (s) self.showMcpEditDialog(s, dlg); }); };
      });
      wrap.querySelectorAll('.wb-mcp-del').forEach(function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute('data-id'));
          self.confirmDialog('删除 MCP 服务器', '确定删除该服务器及其工具配置吗？', function () {
            self.wbMCP.remove(id).then(function () { self._renderMcpList(dlg); });
          });
        };
      });
    });
  };

  WB.showMcpEditDialog = function (server, parentDlg) {
    var self = this;
    var s = server || { name: '', group: '默认', type: 'streamable_http', url: '', headers: null, tools: [] };
    var dlg = this.overlay(
      '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">' + (server ? '编辑 MCP 服务器' : '添加 MCP 服务器') + '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">名称</div>' +
      '<input id="wb-mcp-name" value="' + self.esc(s.name) + '" placeholder="例如: 我的工具箱" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">URL</div>' +
      '<input id="wb-mcp-url" value="' + self.esc(s.url || '') + '" placeholder="https://..." style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;outline:none;margin-bottom:8px;">' +
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
      var headersRaw = dlg.card.querySelector('#wb-mcp-headers').value.trim();
      if (!name || !url) { if (typeof showToast === 'function') showToast('请先填写名称与 URL'); return; }
      var headers = {};
      if (headersRaw) { try { headers = JSON.parse(headersRaw); } catch (e) { if (typeof showToast === 'function') showToast('Headers 不是合法 JSON'); return; } }
      var temp = { name: name, url: url, headers: headers, type: 'streamable_http' };
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
      var headersRaw = dlg.card.querySelector('#wb-mcp-headers').value.trim();
      if (!name || !url) { if (typeof showToast === 'function') showToast('请填写名称与 URL'); return; }
      var headers = {};
      if (headersRaw) { try { headers = JSON.parse(headersRaw); } catch (e) { if (typeof showToast === 'function') showToast('Headers 不是合法 JSON'); return; } }
      var data = Object.assign({}, s, { name: name, url: url, headers: headers, tools: currentTools, updatedAt: Date.now() });
      await self.wbMCP.save(data);
      // 更新系统提示词缓存
      var promptTools = await self.wbMCP.promptTools();
      try { localStorage.setItem('wb_mcp_prompt_tools', JSON.stringify(promptTools)); } catch (e) {}
      dlg.close();
      if (parentDlg) self._renderMcpList(parentDlg);
      if (typeof showToast === 'function') showToast('MCP 服务器已保存');
    };
  };

  // ============ alert 兜底 ============
  WB.alert = function (title, msg) {
    if (typeof window.showCustomAlert === 'function') { window.showCustomAlert(title, msg); return; }
    this.overlay('<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">' + this.esc(title) + '</div><div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">' + this.esc(msg) + '</div><button class="wb-dlg-ok" style="width:100%;padding:9px;border:none;background:var(--primary);border-radius:10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">确定</button>');
  };

})();
