/**
 * ============================================================
 * app_router.js - 叙事诗小手机：全局页面路由中枢
 * ------------------------------------------------------------
 * 目标：把分散在各处的页面导航逻辑收敛为单一路由权威，
 *   1) 维护页面注册表与导航历史栈；
 *   2) 以“包装而非重写”的方式接管 openApp / closeApp / openSettingsLv2，
 *      完整保留既有行为，仅追加历史追踪与模板注入能力；
 *   3) 新增页面（如 TTS 语音设置）以模板形式由路由按需注入，
 *      避免index.html 继续膨胀，逐步精简化结构。
 * ============================================================
 */
(function () {
  "use strict";

  // 页面注册表：id -> { type, init, title }
  // type: "app"  -> 桌面应用窗口 (win-xxx)
  //       "settings-lv2" -> 设置二级面板 (settings-lv2-xxx)
  const pages = {};

  // 导航历史栈（最近一次在栈顶）
  const history = [];

  const Router = {
    pages: pages,
    history: history,

    /**
     * 注册一个页面。
     * @param {string} id   页面标识
     * @param {object} cfg  { type, init, title }
     */
    registerPage: function (id, cfg) {
      pages[id] = Object.assign({ type: "app", init: null, title: id }, cfg || {});
    },

    /**
     * 导航到某个桌面应用窗口（win-xxx）。
     * 内部委托给既有 openApp 实现（已内含各应用的 init 调用），并记录历史。
     * 注意：不再额外调用 cfg.init，避免与原 openApp 重复初始化。
     */
    navigate: function (appId) {
      if (typeof window._origOpenApp === "function") {
        window._origOpenApp(appId);
      } else {
        // 极端回退：原实现缺失时，由路由注册表兜底初始化
        const cfg = pages[appId];
        if (cfg && typeof cfg.init === "function") {
          try { cfg.init(); } catch (e) { console.error("[Router] init error:", e); }
        }
      }
      history.push({ type: "app", id: appId });
    },

    /**
     * 关闭某个桌面应用窗口。委托给既有 closeApp 实现。
     */
    close: function (appId) {
      if (typeof window._origCloseApp === "function") {
        window._origCloseApp(appId);
      }
      // 从历史栈中移除该应用最近一次记录
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].type === "app" && history[i].id === appId) {
          history.splice(i, 1);
          break;
        }
      }
    },

    /**
     * 返回上一页（best-effort）。供未来统一返回键使用。
     */
    back: function () {
      const last = history.pop();
      if (!last) return;
      // 仅处理 app 类型的历史；设置二级面板的返回仍由 handleSettingsBack 负责
      if (last.type === "app") {
        // 关闭当前 app，回到前一个
        if (typeof window._origCloseApp === "function") {
          window._origCloseApp(last.id);
        }
        const prev = history[history.length - 1];
        if (prev && prev.type === "app" && typeof window._origOpenApp === "function") {
          window._origOpenApp(prev.id);
        }
      }
    },

    /**
     * 通用模板注入器：把 HTML 字符串注入到目标容器。
     * @param {string} targetId  目标容器元素 id
     * @param {string} html      模板 HTML
     * @param {string} [anchorId] 锚点元素 id，新节点插入到锚点之后；缺省则追加到目标容器末尾
     */
    injectTemplate: function (targetId, html, anchorId) {
      const target = document.getElementById(targetId);
      if (!target) return null;
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      const node = wrap.firstElementChild;
      if (!node) return null;
      if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(node, anchor.nextSibling);
          return node;
        }
      }
      target.appendChild(node);
      return node;
    },

    /**
     * 进入设置二级面板。对既有 tab 委托原实现；对 "tts" 等新 tab 由路由按需注入模板。
     */
    openSettingsLv2: function (subTab) {
      // 新增 tab：先确保其面板 DOM 存在（模板注入），再走原流程显示
      if (subTab === "tts") {
        this._ensureTtsPanel();
        if (typeof window._origOpenSettingsLv2 === "function") {
          window._origOpenSettingsLv2(subTab);
        }
        // 原 titles 映射不含 tts，这里补齐标题
        const titleEl = document.getElementById("settings-title");
        if (titleEl) titleEl.innerText = "TTS 语音设置";
        if (typeof window.ttsSystem !== "undefined" && typeof window.ttsSystem.initSettingsPanel === "function") {
          window.ttsSystem.initSettingsPanel();
        }
        history.push({ type: "settings-lv2", id: subTab });
        return;
      }
      if (subTab === "vector-memory") {
        this._ensureVectorMemoryPanel();
        if (typeof window._origOpenSettingsLv2 === "function") {
          window._origOpenSettingsLv2(subTab);
        }
        const titleEl2 = document.getElementById("settings-title");
        if (titleEl2) titleEl2.innerText = "向量化记忆设置";
        if (typeof window.vectorMemorySystem !== "undefined" && typeof window.vectorMemorySystem.initPanel === "function") {
          window.vectorMemorySystem.initPanel();
        }
        history.push({ type: "settings-lv2", id: subTab });
        return;
      }
      if (typeof window._origOpenSettingsLv2 === "function") {
        window._origOpenSettingsLv2(subTab);
      }
      history.push({ type: "settings-lv2", id: subTab });
    },

    /**
     * 懒注入 TTS 语音设置二级面板（仅首次进入时创建）。
     * 模板由 ttsSystem 提供，避免在 index.html 中硬编码。
     */
    _ensureTtsPanel: function () {
      if (document.getElementById("settings-lv2-tts")) return;
      const html = (typeof window.ttsSystem !== "undefined" && typeof window.ttsSystem.getSettingsPanelHTML === "function")
        ? window.ttsSystem.getSettingsPanelHTML()
        : '<div id="settings-lv2-tts" class="settings-lv2-panel" style="display:none;"><div class="form-group">TTS 模块加载中…</div></div>';
      // 插入到 API 设置面板之后，保持菜单顺序
      const apiPanel = document.getElementById("settings-lv2-api");
      if (apiPanel && apiPanel.parentNode) {
        const wrap = document.createElement("div");
        wrap.innerHTML = html.trim();
        const node = wrap.firstElementChild;
        if (node) apiPanel.parentNode.insertBefore(node, apiPanel.nextSibling);
      }
    },

    /**
     * 懒注入「向量化记忆设置」二级面板（仅首次进入时创建）。
     * 模板由 vectorMemorySystem 提供，避免在 index.html 中硬编码。
     */
    _ensureVectorMemoryPanel: function () {
      if (document.getElementById("settings-lv2-vector-memory")) return;
      const html = (typeof window.vectorMemorySystem !== "undefined" && typeof window.vectorMemorySystem.getPanelHTML === "function")
        ? window.vectorMemorySystem.getPanelHTML()
        : '<div id="settings-lv2-vector-memory" class="settings-lv2-panel" style="display:none;"><div class="form-group">向量化记忆模块加载中…</div></div>';
      // 插入到 TTS 面板之后，保持菜单顺序（TTS → 向量化记忆）
      const ttsPanel = document.getElementById("settings-lv2-tts");
      const apiPanel = document.getElementById("settings-lv2-api");
      const anchor = ttsPanel || apiPanel;
      if (anchor && anchor.parentNode) {
        const wrap = document.createElement("div");
        wrap.innerHTML = html.trim();
        const node = wrap.firstElementChild;
        if (node) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      }
    },

    /**
     * 初始化：注册已知桌面应用页面及其初始化函数。
     */
    _init: function () {
      const appInits = {
        settings: "initSettingsApp",
        archive: "initArchiveApp",
        world_book: "initWorldBookApp",
        chat: "initChatApp",
        deeptalk: "initDeeptalkApp",
        reader: "initReaderApp",
        forum: "initForumApp",
        couples: "initCouplesApp",
        music: "initMusicApp"
      };
      Object.keys(appInits).forEach(function (appId) {
        const fnName = appInits[appId];
        Router.registerPage(appId, {
          type: "app",
          title: appId,
          init: function () {
            if (typeof window[fnName] === "function") window[fnName]();
          }
        });
      });
    }
  };

  // 包裹既有全局导航函数（保留原始引用，零破坏接管）
  // 注意：必须在 app_desktop.js / app_settings.js 之后加载本文件。
  window._origOpenApp = window.openApp;
  window._origCloseApp = window.closeApp;
  window._origOpenSettingsLv2 = window.openSettingsLv2;

  window.openApp = function (app) {
    Router.navigate(app);
  };
  window.closeApp = function (app) {
    Router.close(app);
  };
  window.openSettingsLv2 = function (subTab) {
    Router.openSettingsLv2(subTab);
  };

  // 暴露路由对象，供控制台与新代码调用
  window.Router = Router;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { Router._init(); });
  } else {
    Router._init();
  }
})();
