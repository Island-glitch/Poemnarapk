/**
 * app_desktop.js - 桌面网格、桌面美化、组件工坊宽高占位自适应与长按编辑 (安全防护与函数补全版)
 */

let isDesktopEditMode = false;
let currentDesktopPage = 0;
let lastRenderedDesktopPage = -1;   // 用于翻页滑入动效的方向判定

// ===== 桌面网格规格：列数固定 4，行数随桌面风格变化 =====
//   M3 桌面（默认）= 4 列 × 7 行 = 每页 28 格
//   清透凉夏等旧预设 = 4 列 × 5 行 = 每页 20 格（不能改，否则它的小部件排版会乱）
const DESKTOP_COLS = 4;
const DESKTOP_DEFAULT_ROWS = 7;
const DESKTOP_LEGACY_PAGE_SIZE = 20;                     // 旧版每页 20 格（4 列 × 5 行）
let DESKTOP_ROWS = DESKTOP_DEFAULT_ROWS;
let DESKTOP_PAGE_SIZE = DESKTOP_COLS * DESKTOP_ROWS;

/** 当前桌面行数（存 localStorage，随预设切换） */
function getDesktopRows() {
  let r = 0;
  try { r = parseInt(localStorage.getItem("desktop-rows"), 10) || 0; } catch (e) {}
  if (!r) r = DESKTOP_DEFAULT_ROWS;
  return Math.max(3, Math.min(10, r));
}
/** 切换桌面行数（同步页宽），预设切换时调用 */
function setDesktopGridRows(rows) {
  const r = Math.max(3, Math.min(10, parseInt(rows, 10) || DESKTOP_DEFAULT_ROWS));
  DESKTOP_ROWS = r;
  DESKTOP_PAGE_SIZE = DESKTOP_COLS * r;
  window.DESKTOP_PAGE_SIZE = DESKTOP_PAGE_SIZE;
  try { localStorage.setItem("desktop-rows", String(r)); } catch (e) {}
  return r;
}
window.setDesktopGridRows = setDesktopGridRows;

/** 把一份「旧页宽」的扁平布局按页重排到当前页宽，保持每一页的图标仍留在该页 */
function remapDesktopLayout(arr, fromSize, toSize) {
  if (!Array.isArray(arr) || !arr.length || fromSize === toSize) return arr;
  const pages = Math.max(1, Math.ceil(arr.length / fromSize));
  const next = new Array(pages * toSize).fill(null);
  for (let p = 0; p < pages; p++) {
    for (let i = 0; i < fromSize; i++) {
      const v = arr[p * fromSize + i];
      if (v !== undefined) next[p * toSize + i] = v;
    }
  }
  return next;
}
window.remapDesktopLayout = remapDesktopLayout;
window.DESKTOP_PAGE_SIZE = DESKTOP_PAGE_SIZE;
window.DESKTOP_LEGACY_PAGE_SIZE = DESKTOP_LEGACY_PAGE_SIZE;

/** 一次性幂等迁移：桌面布局与小部件槽位从旧页宽换成当前页宽 */
function migrateDesktopPageSize() {
  let stored = 0;
  try { stored = parseInt(localStorage.getItem("desktop-page-size"), 10) || 0; } catch (e) {}
  if (stored === DESKTOP_PAGE_SIZE) return;
  const fromSize = stored > 0 ? stored : DESKTOP_LEGACY_PAGE_SIZE;
  if (fromSize === DESKTOP_PAGE_SIZE) { try { localStorage.setItem("desktop-page-size", String(DESKTOP_PAGE_SIZE)); } catch (e) {} return; }

  try {
    const raw = JSON.parse(localStorage.getItem("desktop-layout-v3"));
    if (Array.isArray(raw) && raw.length) {
      localStorage.setItem("desktop-layout-v3", JSON.stringify(remapDesktopLayout(raw, fromSize, DESKTOP_PAGE_SIZE)));
    }
  } catch (e) {}

  try {
    const placed = JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {};
    const next = {};
    Object.keys(placed).forEach((k) => {
      const idx = parseInt(k, 10);
      if (isNaN(idx)) return;
      const p = Math.floor(idx / fromSize);
      const i = idx % fromSize;
      next[p * DESKTOP_PAGE_SIZE + i] = placed[k];
    });
    localStorage.setItem("placed-widgets-desktop", JSON.stringify(next));
  } catch (e) {}

  try { localStorage.setItem("desktop-page-size", String(DESKTOP_PAGE_SIZE)); } catch (e) {}
}

/** 主题可以带一套「设计稿尺寸」（存 beautify-desktop-metrics），按手机宽度等比缩放 */
function getDesktopMetrics() {
  try {
    const m = JSON.parse(localStorage.getItem("beautify-desktop-metrics"));
    if (m && Number(m.designW) > 0) return m;
  } catch (e) {}
  return null;
}
/** 设计稿单位 → 实际像素的缩放比（s = 手机宽度 / 设计稿宽度） */
function desktopScale(metrics) {
  const m = metrics || getDesktopMetrics();
  if (!m) return 1;
  const phone = document.getElementById("phone-container");
  const w = (phone && phone.clientWidth) || document.documentElement.clientWidth || window.innerWidth || m.designW;
  return w / Number(m.designW);
}

/** 行数随主题变化；薄秋用设计稿尺寸（固定行高 + 顶部留白），其它主题沿用原来的 1fr 拉伸 */
function applyDesktopGridMetrics() {
  const desktop = document.getElementById("desktop");
  const grid = document.getElementById("desktop-grid");
  if (!desktop || !grid) return;
  const m = getDesktopMetrics();
  const s = desktopScale(m);

  if (m) {
    // === 设计稿模式（薄秋）：4 列 × N 行，行高/间距/边距全部按设计稿等比缩放 ===
    const padL = Math.round((m.padL || 20) * s);
    const padR = Math.round((m.padR || 20) * s);
    const top = Math.round((m.top || 0) * s);
    const rowH = Math.round((m.rowH || 91) * s);
    const gapY = Math.round((m.gapY || 5) * s);
    const gapX = Math.round((m.gapX || 9) * s);
    const icon = Math.round((m.icon || 56) * s);
    // --desk-s 要写在 #phone-container 上：dock 是 #desktop 的兄弟节点，也要跟着缩放
    const scope = document.getElementById("phone-container") || document.documentElement;
    [desktop, grid, scope, document.documentElement].forEach((el) => {
      if (!el || !el.style) return;
      el.style.setProperty("--desk-s", String(s));
      el.style.setProperty("--desktop-icon", icon + "px");
      el.style.setProperty("--desktop-cell", rowH + "px");
    });
    grid.style.setProperty("grid-template-columns", "repeat(" + DESKTOP_COLS + ", minmax(0, 1fr))", "important");
    grid.style.setProperty("grid-template-rows", "none", "important");
    grid.style.setProperty("grid-auto-rows", rowH + "px", "important");
    grid.style.setProperty("gap", gapY + "px " + gapX + "px", "important");
    grid.style.setProperty("padding", top + "px " + padR + "px 0 " + padL + "px", "important");
    grid.style.setProperty("box-sizing", "border-box", "important");
    grid.style.setProperty("align-content", "start", "important");
    grid.style.setProperty("width", "100%", "important");
    grid.style.setProperty("max-width", "100%", "important");
    grid.style.setProperty("margin", "0", "important");
    return;
  }

  // === 默认模式（清透凉夏等）：保持原版行为，1fr 行高 ===
  // 先把设计稿模式留下的 inline 覆盖清干净，否则切回旧主题会沿用薄秋的间距/行高
  ["grid-template-columns", "grid-auto-rows", "gap", "padding", "align-content", "width", "max-width", "margin"].forEach(function (prop) {
    grid.style.removeProperty(prop);
  });
  [desktop, grid, document.getElementById("phone-container"), document.documentElement].forEach(function (el) {
    if (el && el.style) { el.style.removeProperty("--desk-s"); }
  });
  grid.style.setProperty("grid-template-rows", "repeat(" + DESKTOP_ROWS + ", 1fr)", "important");
  // 用真实渲染出来的槽位高度反推图标尺寸
  const slot = grid.querySelector(".desktop-slot");
  const rowH = slot ? slot.getBoundingClientRect().height : 0;
  if (!rowH) {
    // 桌面还没显示（开屏期间 display:none）时测不到高度，稍后重试一次
    if (!applyDesktopGridMetrics._retried) {
      applyDesktopGridMetrics._retried = true;
      setTimeout(applyDesktopGridMetrics, 500);
    }
    return;
  }
  applyDesktopGridMetrics._retried = false;
  const icon = Math.max(28, Math.min(56, Math.floor(rowH - 12)));
  const cell = Math.max(48, Math.min(80, Math.floor(rowH)));
  [desktop, grid].forEach((el) => {
    el.style.setProperty("--desktop-icon", icon + "px");
    el.style.setProperty("--desktop-cell", cell + "px");
  });
}
window.applyDesktopGridMetrics = applyDesktopGridMetrics;
window.__desktopDebug = function () {
  return {
    pageSize: DESKTOP_PAGE_SIZE, cols: DESKTOP_COLS, rows: DESKTOP_ROWS,
    page: currentDesktopPage, edit: isDesktopEditMode, lastRendered: lastRenderedDesktopPage
  };
};

// 核心初始化保护锁，彻底杜绝重复绑定事件导致的浏览器线程阻塞与死锁
let isDragEventsInitialized = false;
let isAppClickEventsInitialized = false;

// 1. 主动注入网格槽位、长按编辑模式微章 CSS 规范样式，保障顶级质感
(function() {
  const desktopDragStyle = document.createElement("style");
  desktopDragStyle.textContent = `
    #desktop {
      touch-action: none !important; /* 彻底拦截原生手势抢占，解放高精度左右切页滑屏 */
    }
    #desktop-grid {
      display: grid !important;
      grid-template-columns: repeat(4, 1fr) !important;
      /* 行数随主题变化（薄秋 7 行 / 清透凉夏 5 行），由 applyDesktopGridMetrics() 写 inline !important */
      gap: 16px 12px !important;
      min-height: auto !important;
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 auto !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      touch-action: none !important; /* 彻底拦截原生横屏滑动翻页的触控权冲突 */
    }
    #dock-grid {
      /* 与 .dock-container 同源定位：使用 flex+center 居中 4 个图标，
         杜绝 grid 1fr 拉伸造成的容器偏移；固定每格宽度保证视觉锁定正中 */
      display: flex !important;
      flex-direction: row !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 18px !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0 auto !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }
    #dock-grid > .dock-slot {
      /* 固定每个 dock 槽位宽度，确保 4 个图标在 dock 中均匀居中 */
      width: 64px !important;
      flex: 0 0 64px !important;
      aspect-ratio: 1 / 1 !important;
    }
    
    /* 桌面和 Dock 的专属网格槽 */
    .desktop-slot, .dock-slot {
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      width: 100% !important;
      aspect-ratio: 4 / 5 !important; /* 黄金比例锁，防止拉伸 */
      border-radius: 18px !important;
      transition: background-color 0.15s ease, border-color 0.15s ease !important;
      box-sizing: border-box !important;
      border: 1.5px dashed transparent !important;
      position: relative !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    /* 当槽位摆放了自定义小部件组件时，解除比例限制，由小部件本身的行高列宽完全决定占位大小 */
    .desktop-slot.has-widget {
      aspect-ratio: auto !important;
      height: 100% !important;
    }
    
    .app-icon {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
      width: 72px !important; /* 核心修正：固定宽度为标准的72px，绝不使用 100% 从而杜绝追加到body时膨胀 */
      height: auto !important; /* 核心修正：高度完全自适应，绝不使用 100% 从而杜绝追加到body时膨胀 */
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-user-drag: none !important;
      touch-action: none !important; /* 拦截原生触控滑动，确保 pointermove 在滑动切页时被 100% 触发 */
    }
    .app-icon .icon-wrapper {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin: 0 auto 6px auto !important;
      box-sizing: border-box !important;
    }
    .app-icon span {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
      margin: 0 auto !important;
      box-sizing: border-box !important;
    }
    .edit-mode .app-icon {
      /* 仅在编辑模式下激活触控阻断，以便进行拖动重排 */
      touch-action: none !important; 
      cursor: grab;
    }
    .app-icon.dragging {
      width: 72px !important;
      height: auto !important;
      opacity: 0.82;
      transform: scale(1.15) !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2) !important;
      transition: none !important; /* 拖拽过程中严禁任何过渡动画，保证 1:1 跟随 */
    }
    .app-icon-placeholder {
      opacity: 0 !important; /* 幽灵占位符 */
    }

    /* 组件编辑微章 */
    .widget-add-badge, .widget-delete-badge {
      position: absolute !important;
      top: -4px !important;
      right: -4px !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      border: none !important;
      color: white !important;
      font-size: 15px !important;
      font-weight: bold !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      z-index: 100 !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2) !important;
      line-height: 1 !important;
    }
    .widget-add-badge {
      background-color: #07c160 !important;
    }
    .widget-delete-badge {
      background-color: #ef4444 !important;
    }

    /* 桌面放置组件的卡片容器 */
    .desktop-widget-container {
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      overflow: hidden !important;
      border-radius: 12px !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(desktopDragStyle);
})();

document.addEventListener("DOMContentLoaded", () => {
  // PWA 安全注册，在强更新开关激活时进行卸载处理
  if ('serviceWorker' in navigator) {
    if (localStorage.getItem("system-force-update") === "true") {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let reg of registrations) {
          reg.unregister();
        }
      });
    } else {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          window._swRegistration = reg;
          console.log("PWA SW Online!");
        })
        .catch((e) => console.error("SW failed", e));
    }
  }

  loadDesktopLayout();
          
          // 核心：在初始化加载生命周期中，对点击和拖拽手势进行且仅进行单次安全绑定
          initAppClickEvents();
          initDragEvents();
          initDesktopSwipeEvents(); // 绑定手动滑动翻页事件
          
          applyGlobalSettingsOnLoad(); // 启动时应用壁纸与全局自定义 CSS
  
  // 初始化手机默认底栏颜色
  updateThemeColor("#f4f6fa");
  
  // 初始化网页免打扰全屏监听锁
  initBrowserFullscreenTrigger();
});

// 应用壁纸与全局注入 CSS 的渲染挂载
function applyGlobalSettingsOnLoad() {
  // 背景壁纸应用（新版壁纸存在 IndexedDB，localStorage 里只留一个 asset:wallpaper 标记）
  const bg = localStorage.getItem("beautify-wallpaper") || "";
  const phone = document.getElementById("phone-container");
  const applyBg = (val) => {
    if (!phone) return;
    if (val) {
      phone.style.backgroundImage = `url(${val})`;
      phone.style.backgroundSize = "cover";
      phone.style.backgroundPosition = "center";
    } else {
      phone.style.backgroundImage = "";
      phone.style.backgroundColor = "var(--bg-main)";
    }
    // 主题样式要能区分「有壁纸」和「没壁纸」：有壁纸时主题不能再用 !important 覆盖背景
    phone.classList.toggle("has-wallpaper", !!val);
  };
  if (bg === "asset:wallpaper") {
    tileAssetGet("wallpaper").then(function (v) { applyBg(v || ""); });
  } else {
    applyBg(bg);
    // 老版本的大 dataURL 壁纸：自动搬进数据库，给 localStorage 腾出空间
    if (bg.indexOf("data:image") === 0 && bg.length > 20000) {
      tileAssetSet("wallpaper", bg).then(function (ok) {
        if (ok) { try { localStorage.setItem("beautify-wallpaper", "asset:wallpaper"); } catch (e) {} }
      });
    }
  }

  // 底部 Dock 栏不透明度配置即时拉动渲染
  const opacity = localStorage.getItem("beautify-dock-opacity") || "70";
  const dockContainer = document.querySelector(".dock-container");
  if (dockContainer) {
    dockContainer.style.setProperty("background-color", `rgba(255, 255, 255, ${parseFloat(opacity) / 100})`, "important");
  }

  // 桌面整体放缩配置（解决部分手机型号图标缩小/Dock上移问题）
  const scale = localStorage.getItem("beautify-desktop-scale") || "100";
  applyDesktopScale(parseFloat(scale));

  // 注入式自定义 CSS 预设
  const activeCss = localStorage.getItem("beautify-active-css") || "";
  let styleTag = document.getElementById("global-injected-css");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "global-injected-css";
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = activeCss;

  // 全局自定义字体（来自设置-桌面美化-全局字体板块）
  if (typeof window.applyActiveFont === "function") {
    try { window.applyActiveFont(); } catch (e) {}
  }
}

// 桌面整体放缩：通过 CSS transform: scale 对桌面网格与 Dock 栏整体等比放缩
// 解决部分手机型号因视口/DPR 差异导致图标缩小、Dock 栏上移的问题
function applyDesktopScale(scalePercent) {
  const scale = Math.max(0.5, Math.min(1.5, scalePercent / 100));
  const desktop = document.getElementById("desktop");
  const dock = document.getElementById("dock");
  if (desktop) {
    desktop.style.transformOrigin = "top center";
    desktop.style.transform = `scale(${scale})`;
  }
  if (dock) {
    dock.style.transformOrigin = "bottom center";
    dock.style.transform = `scale(${scale})`;
  }
}

// 浏览器免打扰全屏自锁函数 (隐藏工具栏与链接栏)
function initBrowserFullscreenTrigger() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  
  if (!isStandalone) {
    // 监听首次交互
    const requestFullscreenMode = () => {
      const docEl = document.documentElement;
      let fullscreenPromise = null;
      try {
        if (docEl.requestFullscreen) {
          fullscreenPromise = docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) { /* iOS Safari 兼容 */
          fullscreenPromise = docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          fullscreenPromise = docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          fullscreenPromise = docEl.msRequestFullscreen();
        }

        // 安全捕获拒绝异常 [2]
        if (fullscreenPromise && typeof fullscreenPromise.catch === 'function') {
          fullscreenPromise.catch(err => {
            console.warn("全屏申请被浏览器或安全机制拒绝:", err);
          });
        }
      } catch (err) {
        console.warn("同步环境下的全屏机制拦截:", err);
      }
      
      document.body.removeEventListener('click', requestFullscreenMode);
      document.body.removeEventListener('touchstart', requestFullscreenMode);
    };
    
    document.body.addEventListener('click', requestFullscreenMode);
    document.body.addEventListener('touchstart', requestFullscreenMode);
  }
}

// === 【补回关键缺失函数】：PWA 状态栏主题变色 ===
function updateThemeColor(color) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

const DESKTOP_APPS_CONFIG = {
  settings: { name: "设置", svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>' },
  archive: { name: "档案库", svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0-2-.9-2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>' },
  world_book: { name: "世界书", svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.4z"/></svg>' }, 
  chat: { name: "聊天", svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>' },
  deeptalk: { name: "深谈", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>' },
  reader: { name: "阅读", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 4z"></path></svg>' },
  forum: { name: "论坛", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' },
  couples: { name: "情侣空间", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>' },
  music: { name: "听歌", svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>' },
  shopping: { name: "购物", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>' },
  encounter: { name: "邂逅", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/><circle cx="20" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>' },
  quicktravel: { name: "快穿局", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M5 5l3 3"/><path d="M19 5l-3 3"/><path d="M5 19l3-3"/><path d="M19 19l-3-3"/></svg>' },
  workbench: { name: "工作台", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 8 3 3-3 3"/><path d="M12 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>' },
  yigui: { name: "仪轨", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="17.5" r="1.1" fill="currentColor" stroke="none"/></svg>' },
  // 心动游戏（v1.5.21 新增）：与购物 / 工作台 同级的主界面入口。
  // svg 用 Material Symbols Rounded 的 fingerprint（与薄秋设计稿一致）；
  // 功能本体留待后续窗口实装，当前先落一个占位页面。
  heartgame: { name: "心动游戏", svg: '<svg viewBox="0 -960 960 960"><path fill="currentColor" d="M481-781q106 0 200 45.5T838-604q7 9 4.5 16t-8.5 12q-6 5-14 4.5t-14-8.5q-55-78-141.5-119.5T481-741q-97 0-182 41.5T158-580q-6 9-14 10t-14-4q-7-5-8.5-12.5T126-602q62-85 155.5-132T481-781Zm0 94q135 0 232 90t97 223q0 50-35.5 83.5T688-257q-51 0-87.5-33.5T564-374q0-33-24.5-55.5T481-452q-34 0-58.5 22.5T398-374q0 97 57.5 162T604-121q9 3 12 10t1 15q-2 7-8 12t-15 3q-104-26-170-103.5T358-374q0-50 36-84t87-34q51 0 87 34t36 84q0 33 25 55.5t59 22.5q34 0 58-22.5t24-55.5q0-116-85-195t-203-79q-118 0-203 79t-85 194q0 24 4.5 60t21.5 84q3 9-.5 16T208-205q-8 3-15.5-.5T182-217q-15-39-21.5-77.5T154-374q0-133 96.5-223T481-687Zm0-192q64 0 125 15.5T724-819q9 5 10.5 12t-1.5 14q-3 7-10 11t-17-1q-53-27-109.5-41.5T481-839q-58 0-114 13.5T260-783q-8 5-16 2.5T232-791q-4-8-2-14.5t10-11.5q56-30 117-46t124-16Zm0 289q93 0 160 62.5T708-374q0 9-5.5 14.5T688-354q-8 0-14-5.5t-6-14.5q0-75-55.5-125.5T481-550q-76 0-130.5 50.5T296-374q0 81 28 137.5T406-123q6 6 6 14t-6 14q-6 6-14 6t-14-6q-59-62-90.5-126.5T256-374q0-91 66-153.5T481-590Zm-1 196q9 0 14.5 6t5.5 14q0 75 54 123t126 48q6 0 17-1t23-3q9-2 15.5 2.5T744-191q2 8-3 14t-13 8q-18 5-31.5 5.5t-16.5.5q-89 0-154.5-60T460-374q0-8 5.5-14t14.5-6Z"/></svg>' },
  // 占位图标（用户预留给下一个功能的入口，图标为 key）
  placeholder: { name: "占位图标", svg: '<svg viewBox="0 -960 960 960"><path fill="currentColor" d="M280-400q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Zm0 160q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h335q8 0 15.5 3t13.5 9l80 80q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L805-325q-5 5-12 8t-14 4q-7 1-14-1t-13-7l-52-39-57 43q-5 4-11 6t-12 2q-6 0-12.5-2t-11.5-6l-61-43h-47q-32 54-86.5 87T280-240Zm0-80q56 0 98.5-34t56.5-86h125l58 41v.5-.5l82-61 71 55 75-75h-.5.5l-40-40v-.5.5H435q-14-52-56.5-86T280-640q-66 0-113 47t-47 113q0 66 47 113t113 47Z"/></svg>' }
};

function loadDesktopLayout() {
  const grid = document.getElementById("desktop-grid");
  const dock = document.getElementById("dock-grid");

  // 0. 读取当前桌面风格的行数 / 页宽（薄秋 7 行 28 格；清透凉夏等旧预设 5 行 20 格）
  DESKTOP_ROWS = getDesktopRows();
  DESKTOP_PAGE_SIZE = DESKTOP_COLS * DESKTOP_ROWS;
  migrateDesktopPageSize();
  // 0.5 旧版存在 localStorage 里的照片/横幅图搬到 IndexedDB（localStorage 5MB 会被写爆）
  migrateTileAssetsToDb();

  // 1. 读取并平滑迁移老用户的非网格版布局数据，自动将其校准为 v3 版吸附格式
  let desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3"));
  if (!desktopLayout || !Array.isArray(desktopLayout)) {
    const oldLayout = JSON.parse(localStorage.getItem("desktop-layout"));
    desktopLayout = Array(DESKTOP_LEGACY_PAGE_SIZE).fill(null);
    if (oldLayout && Array.isArray(oldLayout)) {
      oldLayout.forEach((id, idx) => {
        if (idx < DESKTOP_LEGACY_PAGE_SIZE) desktopLayout[idx] = id;
      });
      // 老数据迁移后同样写回 v3，避免后续 isAppAlreadyPlaced / placeAppOnSlot 读到 null
      while (desktopLayout.length < DESKTOP_PAGE_SIZE * 2) desktopLayout.push(null);
      localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
    } else if (!window.__defaultPresetApplied && typeof window.applyPresetSilently === "function"
               && window.DESKTOP_PRESETS && window.DESKTOP_PRESETS.thin_autumn) {
      // 全新安装：默认就是「叙事诗 · 桌面 (M3)」——大时钟 + 照片卡 + 圆形图标
      window.__defaultPresetApplied = true;
      window.applyPresetSilently("thin_autumn");
      return loadDesktopLayout();
    } else {
            desktopLayout = Array(DESKTOP_PAGE_SIZE * 2).fill(null); // 两页，每页 4 列 × 7 行
            // 规则：chat / world_book / archive 只放 Dock 栏，不占主页面格子
            desktopLayout[0] = 'encounter';
            desktopLayout[1] = 'deeptalk';
            desktopLayout[2] = 'reader';
            desktopLayout[3] = 'forum';
            desktopLayout[4] = 'couples';
            // 第二页：听歌 + 购物 + 快穿局 + 工作台 + 仪轨
            desktopLayout[DESKTOP_PAGE_SIZE] = 'music';
            desktopLayout[DESKTOP_PAGE_SIZE + 1] = 'shopping';
            desktopLayout[DESKTOP_PAGE_SIZE + 2] = 'quicktravel';
            desktopLayout[DESKTOP_PAGE_SIZE + 3] = 'workbench';
            desktopLayout[DESKTOP_PAGE_SIZE + 4] = 'yigui';
            // 第二页第 6 格起：心动游戏 + 占位图标（v1.5.21 新增，紧随仪轨之后）
            desktopLayout[DESKTOP_PAGE_SIZE + 5] = 'heartgame';
            desktopLayout[DESKTOP_PAGE_SIZE + 6] = 'placeholder';
            // 关键修复：默认布局必须立即写回 localStorage，否则 isAppAlreadyPlaced / placeAppOnSlot
            //   会读到 null，导致"添加图标列表显示全部"+"添加后覆盖成空数组使全部图标消失"
            localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
          }
        }

  let dockLayout = JSON.parse(localStorage.getItem("dock-layout-v3"));
  if (!dockLayout || !Array.isArray(dockLayout)) {
    const oldDock = JSON.parse(localStorage.getItem("dock-layout"));
    dockLayout = Array(4).fill(null);
    if (oldDock && Array.isArray(oldDock)) {
      oldDock.forEach((id, idx) => {
        if (idx < 4) dockLayout[idx] = id;
      });
      localStorage.setItem("dock-layout-v3", JSON.stringify(dockLayout));
    } else {
      // 默认 Dock：聊天 / 档案库 / 世界书 / 设置（chat/archive/world_book 只放 Dock）
      dockLayout[0] = 'chat';
      dockLayout[1] = 'archive';
      dockLayout[2] = 'world_book';
      dockLayout[3] = 'settings';
      // 同步写回，与 desktopLayout 保持一致，杜绝读取到 null 的隐患
      localStorage.setItem("dock-layout-v3", JSON.stringify(dockLayout));
    }
  }

  // 1.5 强制迁移：只要布局中没有"邂逅"图标就强制补入（不依赖一次性标记）
  //      之前的迁移标记可能导致用户永远拿不到邂逅，现改为幂等检查
  {
    const hasEncounter = (Array.isArray(desktopLayout) && desktopLayout.includes("encounter"))
                      || (Array.isArray(dockLayout) && dockLayout.includes("encounter"));
    if (!hasEncounter) {
      // 确保 desktopLayout 至少有 40 格（两页）
      while (desktopLayout.length < DESKTOP_PAGE_SIZE * 2) desktopLayout.push(null);
      // 找到第一个空位放置邂逅（避免覆盖已有 app 和 widget 占用区）
      // 优先尝试槽位 0；若 0 已被占用，则找第一个空槽
      let targetIdx = -1;
      // 检查槽位 0 是否被 widget 占用
      const placedWidgetsDesktop = (() => {
        try { return JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {}; }
        catch(e) { return {}; }
      })();
      if (!desktopLayout[0] && !placedWidgetsDesktop["0"]) {
        targetIdx = 0;
      } else {
        // 找第一个既无 app 又无 widget 的空槽
        for (let i = 0; i < desktopLayout.length; i++) {
          if (!desktopLayout[i] && !placedWidgetsDesktop[String(i)]) {
            targetIdx = i;
            break;
          }
        }
      }
      if (targetIdx >= 0) {
        desktopLayout[targetIdx] = "encounter";
        localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
      }
    }
  }

  // 1.6 强制迁移：快穿局图标幂等补入（与邂逅同策略，老用户升级后自动出现在桌面空位）
  {
    const hasQt = (Array.isArray(desktopLayout) && desktopLayout.includes("quicktravel"))
               || (Array.isArray(dockLayout) && dockLayout.includes("quicktravel"));
    if (!hasQt) {
      while (desktopLayout.length < DESKTOP_PAGE_SIZE * 2) desktopLayout.push(null);
      const placedWidgetsDesktop2 = (() => {
        try { return JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {}; }
        catch(e) { return {}; }
      })();
      let targetIdx2 = -1;
      for (let i = 0; i < desktopLayout.length; i++) {
        if (!desktopLayout[i] && !placedWidgetsDesktop2[String(i)]) {
          targetIdx2 = i;
          break;
        }
      }
      if (targetIdx2 >= 0) {
        desktopLayout[targetIdx2] = "quicktravel";
        localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
      }
    }
  }

  // 1.7 强制迁移：仪轨图标幂等补入（工作台之后优先，老用户升级后自动出现）
  {
    const hasYg = (Array.isArray(desktopLayout) && desktopLayout.includes("yigui"))
               || (Array.isArray(dockLayout) && dockLayout.includes("yigui"));
    if (!hasYg) {
      while (desktopLayout.length < DESKTOP_PAGE_SIZE * 2) desktopLayout.push(null);
      const placedWidgetsDesktop3 = (() => {
        try { return JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {}; }
        catch(e) { return {}; }
      })();
      const wbIdx = desktopLayout.indexOf("workbench");
      let targetIdx3 = -1;
      // 优先放在工作台后面一格；被占用则找第一个空位
      if (wbIdx >= 0 && wbIdx + 1 < desktopLayout.length && !desktopLayout[wbIdx + 1] && !placedWidgetsDesktop3[String(wbIdx + 1)]) {
        targetIdx3 = wbIdx + 1;
      } else {
        for (let i = 0; i < desktopLayout.length; i++) {
          if (!desktopLayout[i] && !placedWidgetsDesktop3[String(i)]) { targetIdx3 = i; break; }
        }
      }
      if (targetIdx3 >= 0) {
        desktopLayout[targetIdx3] = "yigui";
        localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
      }
    }
  }

  // 1.8 强制迁移：心动游戏 + 占位图标 幂等补入（v1.5.21）
  //     策略与仪轨一致：优先紧跟在仪轨后面连续两格，其次找第一个空位。
  //     顺序固定为「心动游戏 -> 占位图标」，保证老用户升级后也能在仪轨后面看到它们。
  {
    const placedWidgetsDesktop4 = (() => {
      try { return JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {}; }
      catch(e) { return {}; }
    })();
    const slotFree = (i) => (i >= 0 && i < desktopLayout.length && !desktopLayout[i] && !placedWidgetsDesktop4[String(i)]);
    const inDock = (id) => Array.isArray(dockLayout) && dockLayout.includes(id);

    const missing = ["heartgame", "placeholder"].filter(id =>
      !inDock(id) && !(Array.isArray(desktopLayout) && desktopLayout.includes(id))
    );

    if (missing.length > 0) {
      while (desktopLayout.length < DESKTOP_PAGE_SIZE * 2) desktopLayout.push(null);
      // 先算好起点：仪轨之后；否则从工作台之后；再否则第一个空位
      let cursor = -1;
      const ygIdx = desktopLayout.indexOf("yigui");
      const wbIdx2 = desktopLayout.indexOf("workbench");
      if (ygIdx >= 0) cursor = ygIdx + 1;
      else if (wbIdx2 >= 0) cursor = wbIdx2 + 1;

      for (const appId of missing) {
        let target = -1;
        // 1) 从 cursor 往右找第一个空位
        if (cursor >= 0) {
          for (let i = cursor; i < desktopLayout.length; i++) {
            if (slotFree(i)) { target = i; break; }
          }
        }
        // 2) 仍没有则从头找
        if (target < 0) {
          for (let i = 0; i < desktopLayout.length; i++) {
            if (slotFree(i)) { target = i; break; }
          }
        }
        if (target >= 0) {
          desktopLayout[target] = appId;
          cursor = target + 1;
        }
      }
      localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
    }
  }

  // 2. 渲染网格 (支持多页切换及补位)
  const pageCount = Math.max(1, Math.ceil(desktopLayout.length / DESKTOP_PAGE_SIZE));
  if (currentDesktopPage >= pageCount) {
    currentDesktopPage = pageCount - 1;
  }
  
  const pageStart = currentDesktopPage * DESKTOP_PAGE_SIZE;
  const pageLayout = desktopLayout.slice(pageStart, pageStart + DESKTOP_PAGE_SIZE);
  while (pageLayout.length < DESKTOP_PAGE_SIZE) {
    pageLayout.push(null);
  }

  let isPageBlank = true;
  for (let i = 0; i < DESKTOP_PAGE_SIZE; i++) {
    if (pageLayout[i] !== null) {
      isPageBlank = false;
      break;
    }
    if (getPlacedWidget("desktop", i) !== null) {
      isPageBlank = false;
      break;
    }
  }

  renderLayout(grid, pageLayout, "desktop-slot");
  renderLayout(dock, dockLayout, "dock-slot");
  renderPageIndicator(pageCount, isPageBlank);
  // 4 列 × 7 行按可用高度自适应图标尺寸（保证 7 行刚好装进一屏，不出现滚动）
  applyDesktopGridMetrics();
  // 翻页滑入动效（只在页码真的变化时播放）
  if (lastRenderedDesktopPage !== currentDesktopPage) {
    const dir = currentDesktopPage > lastRenderedDesktopPage && lastRenderedDesktopPage >= 0 ? "r" : "l";
    grid.classList.remove("page-anim-r", "page-anim-l");
    void grid.offsetWidth;
    grid.classList.add(dir === "r" ? "page-anim-r" : "page-anim-l");
    lastRenderedDesktopPage = currentDesktopPage;
  }
  if (!window.__desktopMetricsBound) {
    window.__desktopMetricsBound = true;
    window.addEventListener("resize", () => applyDesktopGridMetrics());
    window.addEventListener("orientationchange", () => setTimeout(applyDesktopGridMetrics, 120));
  }

  // [3] 应用每页独立的 dock 栏 Y 轴偏移
  applyDockYOffset();

  // [3] 编辑模式下添加 dock 栏拖拽手柄
  setupDockDragHandle();

  // 清理任何残留的老版右上角删除按钮，保持 UI 清爽
  let delBtn = document.getElementById("btn-delete-page-indicator");
  if (delBtn) delBtn.remove();
}

// [3] dock 栏 Y 轴偏移：每页独立存储，解决部分浏览器 dock 栏缩到上方的问题
function getDockYOffsetKey() {
  return `dock-y-offset-page${currentDesktopPage}`;
}
function applyDockYOffset() {
  const dock = document.getElementById("dock");
  if (!dock) return;
  const offset = parseFloat(localStorage.getItem(getDockYOffsetKey()) || "0");
  dock.style.transform = offset ? `translateY(${offset}px)` : "";
}
// [3] 编辑模式下添加 dock 拖拽手柄，可上下移动整个 dock 栏
function setupDockDragHandle() {
  const dock = document.getElementById("dock");
  if (!dock) return;
  // 移除已有手柄
  const existingHandle = document.getElementById("dock-drag-handle");
  if (existingHandle) existingHandle.remove();

  if (!isDesktopEditMode) {
    dock.style.cursor = "";
    return;
  }

  // 创建拖拽手柄条
  const handle = document.createElement("div");
  handle.id = "dock-drag-handle";
  handle.style.cssText = "position:absolute; top:-28px; left:50%; transform:translateX(-50%); background:rgba(30,41,59,0.85); color:#fff; font-size:9px; font-weight:700; padding:3px 10px; border-radius:8px; white-space:nowrap; pointer-events:none; z-index:50;";
  handle.textContent = "↑↓ 拖动 Dock 栏";
  dock.style.position = "relative";
  dock.appendChild(handle);

  // 拖拽逻辑
  dock.style.cursor = "ns-resize";
  let startY = 0;
  let startOffset = 0;
  let isDragging = false;

  const onTouchStart = (e) => {
    // [3] 只在点击 dock 背景区域（非图标）时触发拖拽，避免与图标重排冲突
    if (e.target.closest(".app-icon") || e.target.closest(".desktop-widget-container")) return;
    isDragging = true;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    startOffset = parseFloat(localStorage.getItem(getDockYOffsetKey()) || "0");
    dock.style.transition = "none";
    if (handle) {
      handle.style.pointerEvents = "none";
      handle.textContent = `偏移: ${Math.round(startOffset)}px`;
    }
    e.preventDefault();
  };
  const onTouchMove = (e) => {
    if (!isDragging) return;
    const currentY = (e.touches ? e.touches[0].clientY : e.clientY);
    let delta = currentY - startY;
    let newOffset = startOffset + delta;
    // 限制范围：向上最多移动 200px，向下最多 100px
    newOffset = Math.max(-200, Math.min(100, newOffset));
    dock.style.transform = `translateY(${newOffset}px)`;
    if (handle) handle.textContent = `偏移: ${Math.round(newOffset)}px`;
    e.preventDefault();
  };
  const onTouchEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    dock.style.transition = "";
    // 读取最终偏移并保存
    const transform = dock.style.transform;
    const match = transform.match(/translateY\(([-\d.]+)px\)/);
    const finalOffset = match ? parseFloat(match[1]) : 0;
    localStorage.setItem(getDockYOffsetKey(), String(finalOffset));
    if (handle) {
      handle.textContent = "↑↓ 拖动 Dock 栏";
      handle.style.pointerEvents = "none";
    }
  };

  dock.onmousedown = onTouchStart;
  dock.onmousemove = onTouchMove;
  dock.onmouseup = onTouchEnd;
  dock.onmouseleave = onTouchEnd;
  dock.ontouchstart = onTouchStart;
  dock.ontouchmove = onTouchMove;
  dock.ontouchend = onTouchEnd;
}

function renderPageIndicator(pageCount, isPageBlank) {
  const indicator = document.getElementById("desktop-page-indicator");
  if (!indicator) return;
  indicator.innerHTML = "";

  // 只有一页且不在编辑模式时，指示器没必要占位置（也让 7 行网格多出一点高度）
  if (pageCount <= 1 && !isDesktopEditMode) {
    indicator.style.display = "none";
    return;
  }
  indicator.style.display = "flex";

  const isLastPage = currentDesktopPage === pageCount - 1;
  const canDeleteCurrentPage = isDesktopEditMode && pageCount > 1 && isLastPage && isPageBlank;

  for (let i = 0; i < pageCount; i++) {
    const dot = document.createElement("div");
    
    if (i === currentDesktopPage && canDeleteCurrentPage) {
      // 在编辑模式下，如果当前页是最后一页且是空白页，长条变成一个红色减号
      dot.className = "page-dot active delete-page-dot";
      dot.innerText = "-";
      dot.style.cssText = "background-color: #ef4444 !important; color: white !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 12px !important; font-weight: 800 !important; cursor: pointer !important; border-radius: 99px !important; width: 20px !important; height: 20px !important; line-height: 1 !important;";
      dot.onclick = (e) => {
        e.stopPropagation();
        window.deleteCurrentDesktopPage();
      };
    } else {
      dot.className = `page-dot${i === currentDesktopPage ? " active" : ""}`;
      dot.onclick = () => {
        currentDesktopPage = i;
        loadDesktopLayout();
      };
    }
    indicator.appendChild(dot);
  }

  // 只有在无法删除当前页（即不是空白末页）时，编辑模式下才渲染 "+" 新增页按钮
  if (isDesktopEditMode && !canDeleteCurrentPage) {
    const addBtn = document.createElement("button");
    addBtn.className = "page-add-btn";
    addBtn.innerText = "+";
    addBtn.onclick = () => {
      addNewDesktopPage();
    };
    indicator.appendChild(addBtn);
  }
}

function addNewDesktopPage() {
  let desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3")) || [];
  for (let i = 0; i < DESKTOP_PAGE_SIZE; i++) {
    desktopLayout.push(null);
  }
  localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
  currentDesktopPage = Math.floor(desktopLayout.length / DESKTOP_PAGE_SIZE) - 1;
  loadDesktopLayout();
}

window.deleteCurrentDesktopPage = function() {
  if (confirm("确定要删除当前空白页吗？")) {
    let desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3")) || [];
    const pageStart = currentDesktopPage * DESKTOP_PAGE_SIZE;
    
    // 移除对应页面的20个数据槽
    desktopLayout.splice(pageStart, DESKTOP_PAGE_SIZE);
    localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
    
    // 同步清洗和偏移对应页面及后续页面的组件绑定位置
    try {
      const placed = JSON.parse(localStorage.getItem("placed-widgets-desktop")) || {};
      const newPlaced = {};
      Object.keys(placed).forEach(key => {
        const idx = parseInt(key);
        if (idx < pageStart) {
          newPlaced[idx] = placed[idx];
        } else if (idx >= pageStart + DESKTOP_PAGE_SIZE) {
          newPlaced[idx - DESKTOP_PAGE_SIZE] = placed[idx];
        }
      });
      localStorage.setItem("placed-widgets-desktop", JSON.stringify(newPlaced));
    } catch(e) {}

    if (currentDesktopPage > 0) {
      currentDesktopPage--;
    }
    loadDesktopLayout();
  }
};

// 检查某个槽位是否被自定义小部件组件占用
function getPlacedWidget(type, index) {
  try {
    const placed = JSON.parse(localStorage.getItem(`placed-widgets-${type}`)) || {};
    const realIndex = type === "desktop" ? (currentDesktopPage * DESKTOP_PAGE_SIZE + index) : index;
    const widgetId = placed[realIndex];
    if (widgetId) {
      const widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
      return widgets[widgetId] || null; // 返回整个 widget 对象，包含行高列宽
    }
  } catch(e) {}
  return null;
}
// ============================================================
//  桌面内置卡片（时钟 / 照片 / 横幅 / 搜索条）
//  这些卡片由 renderLayout 直接挂载，不是 HTML 字符串小部件；
//  内容存 localStorage（键前缀 desktop-tile-），重启后仍在，也会随自动备份一起走。
// ============================================================
const TILE_KEY_PREFIX = "desktop-tile-";
const TILE_ICON = {
  plus: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>'
};

function tileGet(key, fallback) {
  try { const v = localStorage.getItem(TILE_KEY_PREFIX + key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function tileSet(key, value) {
  try { localStorage.setItem(TILE_KEY_PREFIX + key, value); return true; } catch (e) { return false; }
}

// ============================================================
//  图片资源：照片卡 / 横幅背景走 IndexedDB（db.assets）
//  localStorage 只有约 5MB，一张手机照片就能写爆，而且 setItem 抛异常时是静默的
//  —— 所以大图一律进 IndexedDB，并且保留 PNG 原格式（无损）
// ============================================================
const tileAssetCache = Object.create(null);
const TILE_ASSET_TIMEOUT = 3000;   // IndexedDB 被禁用时 Dexie 的 Promise 可能一直挂着

function tileAssetGet(key) {
  if (tileAssetCache[key] !== undefined) return Promise.resolve(tileAssetCache[key]);
  return new Promise(function (resolve) {
    var done = false;
    var fallback = function () {
      if (done) return; done = true;
      var v = tileGet("asset-" + key, "");
      if (v) tileAssetCache[key] = v;   // 只缓存真数据，空结果下次重试
      resolve(v);
    };
    try {
      if (typeof db !== "undefined" && db.assets) {
        db.assets.get(key).then(function (row) {
          if (done) return; done = true;
          var v = (row && row.data) || tileGet("asset-" + key, "");
          if (v) tileAssetCache[key] = v;
          resolve(v);
        }).catch(fallback);
        setTimeout(fallback, TILE_ASSET_TIMEOUT);
        return;
      }
    } catch (e) {}
    fallback();
  });
}
function tileAssetSet(key, dataUrl) {
  tileAssetCache[key] = dataUrl;
  return new Promise(function (resolve) {
    var done = false;
    var fallback = function () {
      if (done) return; done = true;
      // 退路：IndexedDB 不可用时写 localStorage（大图可能失败，会返回 false）
      resolve(tileSet("asset-" + key, dataUrl));
    };
    try {
      if (typeof db !== "undefined" && db.assets) {
        db.assets.put({ key: key, data: dataUrl, updatedAt: Date.now() }).then(function () {
          if (done) return; done = true;
          try { localStorage.removeItem("desktop-tile-asset-" + key); } catch (e) {}
          resolve(true);
        }).catch(function (e) {
          console.warn("[桌面图片] IndexedDB 写入失败，改用 localStorage:", e);
          fallback();
        });
        setTimeout(fallback, TILE_ASSET_TIMEOUT);
        return;
      }
    } catch (e) { console.warn("[桌面图片] 写入异常:", e); }
    fallback();
  });
}
/** 清掉某张图片（内存缓存 + 数据库 + localStorage 退路） */
function tileAssetDel(key) {
  delete tileAssetCache[key];
  try { localStorage.removeItem("desktop-tile-asset-" + key); } catch (e) {}
  try { if (typeof db !== "undefined" && db.assets) return db.assets.delete(key); } catch (e) {}
  return Promise.resolve();
}
window.tileAssetGet = tileAssetGet;
window.tileAssetSet = tileAssetSet;
window.tileAssetDel = tileAssetDel;
window.tileAssetClearCache = function (key) {
  if (key === undefined) { Object.keys(tileAssetCache).forEach(function (k) { delete tileAssetCache[k]; }); }
  else { delete tileAssetCache[key]; }
};
/** 把旧版存在 localStorage 里的照片/横幅图搬进 IndexedDB（一次性） */
function migrateTileAssetsToDb() {
  if (window.__tileAssetMigrated) return;
  window.__tileAssetMigrated = true;
  try {
    const move = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf("desktop-tile-") !== 0) continue;
      const v = localStorage.getItem(k) || "";
      if (k.indexOf("desktop-tile-photo-") === 0 && v.indexOf("data:") === 0) {
        move.push([k, k.replace("desktop-tile-", ""), v]);
      } else if (k.indexOf("desktop-tile-banner-") === 0 && v.indexOf("{") === 0) {
        try {
          const obj = JSON.parse(v);
          if (obj && obj.img && String(obj.img).indexOf("data:") === 0) {
            move.push([k, "banner-" + k.replace("desktop-tile-banner-", ""), obj.img]);
            delete obj.img;
            localStorage.setItem(k, JSON.stringify(obj));
          }
        } catch (e) {}
      }
    }
    move.forEach(function (m) {
      tileAssetSet(m[1], m[2]).then(function (ok) {
        if (ok && m[0].indexOf("desktop-tile-photo-") === 0) { try { localStorage.removeItem(m[0]); } catch (e) {} }
      });
    });
  } catch (e) {}
}
/** 选一张图并压到最长边 maxPx 的 dataURL（PNG 保留透明）
 *  解码优先用 createImageBitmap（内存占用远低于把整张图塞进 dataURL），
 *  失败再退回 blob URL + Image，两边都不行才报错并说明可能是不支持的格式。 */
function tilePickImage(maxPx, cb) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  document.body.appendChild(input);
  input.onchange = () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    tileEncodeImage(file, maxPx).then((out) => {
      if (out) { cb(out); return; }
      if (typeof showToast === "function") {
        showToast("这张图片解析失败：可能是 HEIC/WebP 等本机不支持的格式，或文件已损坏，换一张试试");
      }
    });
  };
  input.click();
}
/** File → dataURL（按最长边 maxPx 缩放，PNG 保持 PNG） */
function tileEncodeImage(file, maxPx) {
  const isPng = /image\/png/i.test(file.type);
  const encode = (src, w, h) => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    return cv.toDataURL(isPng ? "image/png" : "image/jpeg", 0.86);
  };
  const viaBitmap = async () => {
    if (typeof createImageBitmap !== "function") return null;
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { return null; }
    try {
      const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      let src = bmp;
      if (w !== bmp.width || h !== bmp.height) {
        try {
          const resized = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
          src = resized;
        } catch (e) { /* 不支持 resize 参数就直接缩放原图 */ }
      }
      const out = encode(src, w, h);
      if (src !== bmp && src.close) src.close();
      if (bmp.close) bmp.close();
      return out;
    } catch (e) { if (bmp && bmp.close) bmp.close(); return null; }
  };
  const viaImage = () => new Promise((resolve) => {
    let url = "";
    try { url = URL.createObjectURL(file); } catch (e) { return resolve(null); }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        resolve(encode(img, w, h));
      } catch (e) { resolve(null); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
  return (async () => {
    let out = await viaBitmap();
    if (!out) out = await viaImage();
    return out;
  })();
}
window.tileEncodeImage = tileEncodeImage;
/** 自制卡片弹层（项目禁止原生弹窗） */
function tileSheet(opts) {
  const mask = document.createElement("div");
  mask.style.cssText = "position:fixed;inset:0;z-index:100900;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;background:rgba(15,23,42,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);";
  mask.innerHTML =
    '<div style="width:100%;max-width:340px;background:#fff;border-radius:24px;padding:18px;box-sizing:border-box;box-shadow:0 24px 60px rgba(15,23,42,.28);">' +
      '<div style="font-size:15px;font-weight:800;color:#1B1B1F;margin-bottom:12px;">' + (opts.title || "") + '</div>' +
      '<div class="tile-sheet-body">' + (opts.body || "") + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button data-v="0" style="flex:1;padding:11px;border-radius:14px;border:1.5px solid #E2E2E8;background:#fff;color:#464651;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;">取消</button>' +
        '<button data-v="1" style="flex:1.2;padding:11px;border-radius:14px;border:none;background:#9B87B8;color:#fff;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;">' + (opts.okText || "保存") + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll("button[data-v]").forEach((b) => {
    b.onclick = () => {
      const ok = b.getAttribute("data-v") === "1";
      if (ok && typeof opts.onOk === "function") opts.onOk(mask);
      close();
    };
  });
  mask.onclick = (e) => { if (e.target === mask) close(); };
  if (typeof opts.onReady === "function") opts.onReady(mask, close);
  return mask;
}

/** 卡片内部的尺寸按设计稿比例缩放 */
function tileScale(box) {
  const v = parseFloat(getComputedStyle(box).getPropertyValue("--desk-s"));
  return v > 0 && isFinite(v) ? v : 1;
}

window.desktopTiles = {
  /** 挂载一张卡片，返回容器元素 */
  mount(slot, wData) {
    const type = wData.tile;
    const cfg = wData.config || {};
    slot.classList.add("has-widget");
    const box = document.createElement("div");
    // 同时带上 desktop-widget-container：长按编辑、拖拽落点判定等既有逻辑都认这个类
    box.className = "desktop-widget-container desktop-tile desktop-tile-" + type;
    box.style.cssText = "width:100%;height:100%;box-sizing:border-box;";
    slot.appendChild(box);
    const fn = this[type];
    if (typeof fn === "function") { try { fn.call(this, box, cfg, wData); } catch (e) { console.warn("[桌面卡片]", type, e); } }
    return box;
  },

  /** 大号实时时钟 + 可编辑的一行小字（年月日 / 天气等） */
  clock(box, cfg) {
    const s = tileScale(box);
    const key = "clock-" + (cfg.key || "main");
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.justifyContent = "center";
    box.style.gap = Math.round(6 * s) + "px";
    box.style.overflow = "hidden";
    box.style.cursor = "pointer";

    const t = document.createElement("div");
    const maxSize = Math.round((cfg.size || 114) * s);
    t.style.cssText = "font-weight:700;line-height:1;letter-spacing:-0.02em;white-space:nowrap;" +
      "color:" + (cfg.color || "#6B6275") + ";font-variant-numeric:tabular-nums;";
    const sub = document.createElement("div");
    sub.style.cssText = "font-size:" + Math.max(10, Math.round(13 * s)) + "px;font-weight:600;letter-spacing:0.04em;color:" + (cfg.subColor || "#A79FAE") +
      ";white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;";
    box.appendChild(t);
    box.appendChild(sub);

    const autoSub = () => {
      const n = new Date();
      const wk = ["日", "一", "二", "三", "四", "五", "六"][n.getDay()];
      return n.getFullYear() + "年" + (n.getMonth() + 1) + "月" + n.getDate() + "日 星期" + wk;
    };
    // 按卡片可用宽度收缩字号：宁可小一点，也不许换行把下面挤走
    const fit = () => {
      const w = box.clientWidth - 8;
      if (w <= 0) return;
      let fs = maxSize;
      t.style.fontSize = fs + "px";
      let guard = 0;
      while (t.scrollWidth > w && fs > 20 && guard++ < 60) {
        fs -= 2;
        t.style.fontSize = fs + "px";
      }
    };
    const tick = () => {
      if (t.__dead) return;
      const n = new Date();
      t.textContent = String(n.getHours()).padStart(2, "0") + (cfg.colon || ":") + String(n.getMinutes()).padStart(2, "0");
      let data = {};
      try { data = JSON.parse(tileGet(key, "{}")) || {}; } catch (e) { data = {}; }
      const custom = typeof data.sub === "string" ? data.sub.trim() : "";
      sub.textContent = custom || autoSub();
      fit();
      // 首次同步绘制时节点可能还没进 DOM（renderLayout 末尾才 appendChild），
      // 所以只在「已挂载过」之后才用 isConnected 判断是否已被移除并自停。
      if (t.__armed && !t.isConnected) { t.__dead = true; clearInterval(t.__timer); }
    };
    tick();
    requestAnimationFrame(() => { fit(); requestAnimationFrame(fit); });
    t.__armed = true;
    t.__timer = setInterval(tick, 20000);

    box.onclick = (e) => {
      if (isDesktopEditMode) return;
      e.stopPropagation();
      let data = {};
      try { data = JSON.parse(tileGet(key, "{}")) || {}; } catch (e) { data = {}; }
      tileSheet({
        title: "时钟下面的一行小字",
        okText: "保存",
        body:
          '<div style="font-size:11px;font-weight:800;color:#8b8f9c;margin-bottom:6px;">留空则自动显示今天的年月日与星期</div>' +
          '<input id="tile-ck-sub" value="' + String(data.sub || "").replace(/"/g, "&quot;") + '" placeholder="例如：9月9日 · 晴 24℃" style="width:100%;box-sizing:border-box;border:1.5px solid #E8E4EE;border-radius:12px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;">',
        onOk: (mask) => {
          const v = mask.querySelector("#tile-ck-sub").value.trim().slice(0, 40);
          tileSet(key, JSON.stringify({ sub: v }));
          tick();
          if (typeof showToast === "function") showToast(v ? "已保存" : "已恢复自动日期");
        }
      });
    };
  },

  /** 照片卡片：点击上传并持久保存（图片存 IndexedDB，PNG 保持无损） */
  photo(box, cfg) {
    const s = tileScale(box);
    const assetKey = "photo-" + (cfg.key || "a");
    const radius = Math.round((cfg.radius === undefined ? 26 : cfg.radius) * s);
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;height:100%;border-radius:" + radius + "px;overflow:hidden;cursor:pointer;" +
      "background:" + (cfg.emptyBg || "rgba(243,238,248,.8)") + ";display:flex;align-items:center;justify-content:center;box-sizing:border-box;";
    const paint = (src) => {
      if (src) {
        wrap.innerHTML = '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          '<div style="position:absolute;left:0;right:0;bottom:0;padding:' + Math.round(7 * s) + 'px 8px;font-size:' + Math.max(9, Math.round(10 * s)) + 'px;font-weight:700;color:#fff;text-align:center;background:linear-gradient(180deg,rgba(15,23,42,0),rgba(15,23,42,.55));">点击更换</div>';
      } else {
        wrap.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:' + Math.round(7 * s) + 'px;color:#A08FB8;">' +
          '<span style="display:flex;width:' + Math.round(26 * s) + 'px;height:' + Math.round(26 * s) + 'px;">' + TILE_ICON.plus + '</span>' +
          '<span style="font-size:' + Math.max(10, Math.round(11 * s)) + 'px;font-weight:700;">' + (cfg.hint || "添加照片") + '</span></div>';
      }
    };
    paint("");
    tileAssetGet(assetKey).then(function (src) { if (src) paint(src); });
    wrap.onclick = (e) => {
      if (isDesktopEditMode) return;          // 编辑模式下交给拖拽/删除
      e.stopPropagation();
      tilePickImage(cfg.maxPx || 1200, (dataUrl) => {
        tileAssetSet(assetKey, dataUrl).then(function (ok) {
          if (!ok) {
            if (typeof showToast === "function") showToast("照片保存失败，请重试");
            return;
          }
          paint(dataUrl);
          if (typeof showToast === "function") showToast("照片已保存");
        });
      });
    };
    box.appendChild(wrap);
  },

  /** 横幅卡片：背景图（IndexedDB）+ 可编辑标题/副标题（localStorage） */
  banner(box, cfg) {
    const s = tileScale(box);
    const key = "banner-" + (cfg.key || "main");
    const assetKey = key;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;height:100%;border-radius:" + Math.round((cfg.radius === undefined ? 28 : cfg.radius) * s) + "px;overflow:hidden;" +
      "background:rgba(243,238,248,.8);display:flex;flex-direction:column;justify-content:flex-end;cursor:pointer;box-sizing:border-box;";
    let curImg = "";
    const paint = () => {
      let data = {};
      try { data = JSON.parse(tileGet(key, "{}")) || {}; } catch (e) { data = {}; }
      const title = data.title !== undefined ? data.title : (cfg.title || "");
      const sub = data.sub !== undefined ? data.sub : (cfg.sub || "");
      const img = curImg;
      wrap.style.backgroundImage = img ? "url(" + img + ")" : "none";
      wrap.style.backgroundSize = "cover";
      wrap.style.backgroundPosition = "center";
      wrap.innerHTML =
        '<div style="position:absolute;inset:0;background:' + (img ? "linear-gradient(180deg,rgba(15,23,42,.05),rgba(15,23,42,.55))" : "linear-gradient(135deg,#FBEFE3,#EFE6F8)") + ';"></div>' +
        '<div style="position:relative;padding:' + Math.round(16 * s) + 'px ' + Math.round(18 * s) + 'px;color:' + (img ? "#fff" : "#1B1B1F") + ';">' +
          '<div style="font-size:' + Math.round(22 * s) + 'px;font-weight:800;letter-spacing:1px;text-shadow:' + (img ? "0 2px 8px rgba(0,0,0,.35)" : "none") + ';">' + (title || "叙事诗") + '</div>' +
          (sub ? '<div style="font-size:' + Math.max(10, Math.round(12 * s)) + 'px;margin-top:' + Math.round(5 * s) + 'px;opacity:.86;line-height:1.5;">' + sub + '</div>' : '') +
        '</div>';
    };
    paint();
    tileAssetGet(assetKey).then(function (src) { if (src) { curImg = src; paint(); } });
    wrap.onclick = (e) => {
      if (isDesktopEditMode) return;
      e.stopPropagation();
      let data = {};
      try { data = JSON.parse(tileGet(key, "{}")) || {}; } catch (e) { data = {}; }
      const title = data.title !== undefined ? data.title : (cfg.title || "");
      const sub = data.sub !== undefined ? data.sub : (cfg.sub || "");
      let newImg = curImg;
      tileSheet({
        title: "编辑横幅",
        okText: "保存",
        body:
          '<div style="font-size:11px;font-weight:800;color:#64748b;margin-bottom:5px;">标题</div>' +
          '<input id="tile-bn-title" value="' + String(title).replace(/"/g, "&quot;") + '" style="width:100%;box-sizing:border-box;border:1.5px solid #E2E2E8;border-radius:12px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;margin-bottom:12px;">' +
          '<div style="font-size:11px;font-weight:800;color:#64748b;margin-bottom:5px;">副标题</div>' +
          '<input id="tile-bn-sub" value="' + String(sub).replace(/"/g, "&quot;") + '" style="width:100%;box-sizing:border-box;border:1.5px solid #E2E2E8;border-radius:12px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;margin-bottom:12px;">' +
          '<div style="display:flex;gap:8px;">' +
            '<button id="tile-bn-pick" style="flex:1;padding:11px;border:1.5px solid #EDE6F2;background:#fff;border-radius:12px;font-size:12px;font-weight:800;color:#9B87B8;cursor:pointer;font-family:inherit;">选择背景图</button>' +
            '<button id="tile-bn-clear" style="flex:1;padding:11px;border:1.5px solid #F9DEDC;background:#fff;border-radius:12px;font-size:12px;font-weight:800;color:#B3261E;cursor:pointer;font-family:inherit;">清除背景</button>' +
          '</div>',
        onReady: (mask) => {
          mask.querySelector("#tile-bn-pick").onclick = () => {
            tilePickImage(1200, (dataUrl) => { newImg = dataUrl; if (typeof showToast === "function") showToast("背景图已选好，点保存生效"); });
          };
          mask.querySelector("#tile-bn-clear").onclick = () => { newImg = ""; };
        },
        onOk: (mask) => {
          const next = {
            title: mask.querySelector("#tile-bn-title").value.slice(0, 24),
            sub: mask.querySelector("#tile-bn-sub").value.slice(0, 40)
          };
          tileSet(key, JSON.stringify(next));
          curImg = newImg;
          if (newImg) {
            tileAssetSet(assetKey, newImg).then(function (ok) {
              if (!ok && typeof showToast === "function") showToast("背景图保存失败，请重试");
            });
          } else {
            tileAssetCache[assetKey] = "";
            try { if (typeof db !== "undefined" && db.assets) db.assets.delete(assetKey); } catch (e) {}
          }
          paint();
          if (typeof showToast === "function") showToast("横幅已保存");
        }
      });
    };
    box.appendChild(wrap);
  },

  /** 搜索条：点一下跳到听歌并聚焦搜索框 */
  search(box, cfg) {
    box.style.display = "flex";
    box.style.alignItems = "center";
    const bar = document.createElement("div");
    const s = tileScale(box);
    bar.style.cssText = "width:100%;height:100%;border-radius:" + Math.round(28 * s) + "px;background:#fff;box-shadow:0 3px 12px rgba(140,130,150,.12);" +
      "display:flex;align-items:center;gap:" + Math.round(10 * s) + "px;padding:0 " + Math.round(18 * s) + "px;box-sizing:border-box;cursor:pointer;color:#464651;";
    bar.innerHTML = '<span style="display:flex;width:' + Math.round(20 * s) + 'px;height:' + Math.round(20 * s) + 'px;color:#A08FB8;flex-shrink:0;">' + TILE_ICON.search + '</span>' +
      '<span style="flex:1;min-width:0;font-size:' + Math.max(11, Math.round(14 * s)) + 'px;color:#9A93A5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (cfg.label || "搜索歌曲") + '</span>' +
      '<span style="display:flex;width:' + Math.round(18 * s) + 'px;height:' + Math.round(18 * s) + 'px;color:#9A93A5;flex-shrink:0;">' + TILE_ICON.mic + '</span>';
    bar.onclick = (e) => {
      if (isDesktopEditMode) return;
      e.stopPropagation();
      try {
        if (typeof openApp === "function") openApp("music");
        setTimeout(() => {
          if (window.musicSystem && typeof window.musicSystem.switchTab === "function") window.musicSystem.switchTab("search");
          const inp = document.getElementById("ncm-search-keyword");
          if (inp) { try { inp.focus(); } catch (err) {} }
        }, 320);
      } catch (err) {}
    };
    box.appendChild(bar);
  }
};

function renderLayout(container, layoutArray, slotClass) {
  container.innerHTML = "";
  
  // 装载桌面图标自定义完美美化数据
  let customIcons = {};
  try {
    customIcons = JSON.parse(localStorage.getItem("beautify-custom-icons")) || {};
  } catch(e) {}

  // 主题图标覆盖（例如「薄秋」主题用设计稿里的 Material Symbols 图标）
  let themeIcons = {};
  try {
    themeIcons = JSON.parse(localStorage.getItem("beautify-icon-overrides")) || {};
  } catch(e) {}

  const isDesktopType = slotClass === "desktop-slot";
  const typeKey = isDesktopType ? "desktop" : "dock";
  const cols = 4;
  const totalCells = layoutArray.length;

  // === 【物理防挤占核心算法】：预先扫描计算所有被大组件覆盖需要跳过渲染的物理 Slot ===
  const skippedIndices = new Set();
  layoutArray.forEach((id, index) => {
    const wData = getPlacedWidget(typeKey, index);
    if (wData) {
      const w = parseInt(wData.widthSpan) || 1;
      const h = parseInt(wData.heightSpan) || 1;
      const row0 = Math.floor(index / cols);
      const col0 = index % cols;

      // 限制组件物理宽度不能溢出屏幕右边界，防止一维数组折行换算导致的排版破坏
      const actualW = Math.min(w, cols - col0);
      const actualH = h;

      for (let r = 0; r < actualH; r++) {
        for (let c = 0; c < actualW; c++) {
          if (r === 0 && c === 0) continue; // 跳过左上角原点，原点是实际挂载组件的容器
          const coveredIndex = (row0 + r) * cols + (col0 + c);
          if (coveredIndex < totalCells) {
            skippedIndices.add(coveredIndex);
          }
        }
      }
    }
  });

  // 2. 依次渲染未被遮盖的 Slot，从物理上消除“挤兑”现象
  layoutArray.forEach((id, index) => {
    // 核心拦截：如果格子被大组件完全遮盖，直接不渲染 DOM，使大组件自然住在上面
    if (skippedIndices.has(index)) {
      return;
    }

    const slot = document.createElement("div");
    slot.className = slotClass;
    slot.setAttribute("data-index", index);
    
    // 检查此网格槽位是否被自定义代码组件挂载
    const wData = getPlacedWidget(typeKey, index);
    if (wData) {
      slot.classList.add("has-widget");
      // 限制组件物理跨度
      const col0 = index % cols;
      const actualW = Math.min(parseInt(wData.widthSpan) || 1, cols - col0);

      // v1.5.21：支持「显式列号」。
      // 网格是 grid-auto-flow:row 且历史上只设置 span（没有列号），所以组件的**列位置**
      // 实际由自动排布决定 —— 槽位号只能决定"第几行第几个"，一旦同一行前面少了元素，
      // 组件就会被自动挤到左边（薄秋第二页右下角那张照片就是这么跑偏的）。
      // 预设可给卡片声明 colStart（1 基，设计稿列号），这里落成 grid-column-start，
      // 让「第 6-7 行、右侧两列」这种意图能被精确表达；未声明的卡片行为完全不变。
      const colStart = parseInt(wData.colStart);
      if (isDesktopType && colStart >= 1) {
        const safeStart = Math.min(colStart, cols);
        const safeSpan = Math.min(actualW, cols - safeStart + 1);
        slot.style.gridColumn = `${safeStart} / span ${safeSpan}`;
      } else {
        slot.style.gridColumn = `span ${actualW}`;
      }
      slot.style.gridRow = `span ${wData.heightSpan || 1}`;
      // 设计稿模式：卡片可以带固定高度（设计稿单位），顶部对齐，多余行高留在下方
      if (isDesktopType && wData.fixedH) {
        const sc = desktopScale();
        slot.style.setProperty("height", Math.round(Number(wData.fixedH) * sc) + "px", "important");
        slot.style.alignSelf = "start";
      }

      if (wData.tile && window.desktopTiles) {
        // 内置卡片（时钟/照片/横幅/搜索条）：由运行时直接挂载
        window.desktopTiles.mount(slot, wData);
      } else {
        const widgetDiv = document.createElement("div");
        widgetDiv.className = "desktop-widget-container";
        widgetDiv.innerHTML = wData.html;

        // 强制促使组件内部嵌套 script 在运行态重新注入执行
        const scripts = widgetDiv.querySelectorAll("script");
        scripts.forEach(oldScript => {
          const newScript = document.createElement("script");
          newScript.text = oldScript.innerHTML;
          oldScript.parentNode.replaceChild(newScript, oldScript);
        });

        slot.appendChild(widgetDiv);
      }

      // 编辑模式下显示红色叉号 (去 Emoji 风格)
      if (isDesktopEditMode) {
        const delBtn = document.createElement("button");
        delBtn.className = "widget-delete-badge";
        delBtn.innerHTML = "×";
        delBtn.onclick = (e) => {
          e.stopPropagation();
          removeWidgetFromSlot(typeKey, index);
        };
        slot.appendChild(delBtn);
      }
    } else if (id) {
      const info = DESKTOP_APPS_CONFIG[id];
      if (info) {
        const div = document.createElement("div");
        div.className = "app-icon";
        div.setAttribute("data-app", id);
        
        // 渲染美化过或原生的图标（主题可以覆盖图标：beautify-icon-overrides，如「薄秋」用的 Material Symbols）
        const customImg = customIcons[id];
        const themeIcon = (themeIcons && themeIcons[id]) || null;
        const iconHtml = customImg ? `<img src="${customImg}" class="custom-icon-img" style="width:100%; height:100%; object-fit:cover; border-radius:18px;">` : (themeIcon || info.svg);

        // 核心：若为 Dock 栏图标，直接过滤擦除 Span 文本标签，仅保留 icon-wrapper 的 SVG 渲染
        const nameHtml = isDesktopType ? `<span>${info.name}</span>` : "";

        div.innerHTML = `
          <div class="icon-wrapper">${iconHtml}</div>
          ${nameHtml}
        `;
        // 点击统一由 document 捕获阶段的处理器接管（见文件下方的全局监听）。
        // 这里不再逐个图标挂监听：图标有多条渲染路径，逐个挂容易漏，
        // 而漏挂的表现就是「点这个图标完全没反应」。
        // 只保留一个标记位，供 __deskIconTapRecall 做去重。
        div.__hgTapOk = false;
        slot.appendChild(div);

        // 编辑模式下应用支持红叉删除卸载 (系统应用卸载)
        if (isDesktopEditMode) {
          const delBtn = document.createElement("button");
          delBtn.className = "widget-delete-badge";
          delBtn.innerHTML = "×";
          delBtn.onclick = (e) => {
            e.stopPropagation();
            removeAppFromSlot(typeKey, index);
          };
          slot.appendChild(delBtn);
        }
      }
    } else {
      // 编辑模式下的空槽位显示绿色加号，用于添加系统应用或自定义小组件
      if (isDesktopEditMode) {
        const addBtn = document.createElement("button");
        addBtn.className = "widget-add-badge";
        addBtn.innerHTML = "+";
        addBtn.onclick = (e) => {
          e.stopPropagation();
          openAddSelector(typeKey, index);
        };
        slot.appendChild(addBtn);
      }
    }
    container.appendChild(slot);
  });
}

let lastPointerDownX = 0;
let lastPointerDownY = 0;
document.addEventListener("pointerdown", (e) => {
  lastPointerDownX = e.clientX;
  lastPointerDownY = e.clientY;
});

// 桌面图标点击的**全局捕获阶段**处理器。
// 为什么用捕获阶段挂在 document 上，而不是逐个图标挂监听：
//   图标可能由多条渲染路径产生（预设布局 / 迁移补位 / 手动添加 / dock），
//   只要有一条路径漏挂了监听，那个图标就会「点了完全没反应」。
//   挂 document + capture 可以保证**任何**来源的 .app-icon 都被接管到。
// 判定方式与逐个挂监听时完全一致：自己比较按下/抬起位移，14px 内且未长按视为点击。
(function () {
  var downX = 0, downY = 0, downAt = 0, downIcon = null;

  function iconOf(e) {
    var t = e.target;
    if (!t || !t.closest) return null;
    return t.closest('.app-icon');
  }

  document.addEventListener('pointerdown', function (e) {
    var icon = iconOf(e);
    if (!icon) { downIcon = null; return; }
    downIcon = icon;
    downX = e.clientX; downY = e.clientY; downAt = Date.now();
  }, true);

  document.addEventListener('pointerup', function (e) {
    if (!downIcon) return;
    var icon = downIcon;
    downIcon = null;
    var moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    // 位移 >14px 视为滑动翻页；按住 >700ms 视为长按（编辑模式）
    if (moved > 14 || (Date.now() - downAt) > 700) return;
    if (icon.__hgTapOk) return;                 // 已由其它路径处理
    if (typeof window.__deskIconTapRecall === 'function') window.__deskIconTapRecall(icon);
  }, true);

  document.addEventListener('pointercancel', function () { downIcon = null; }, true);

  // 鼠标 / 无 pointer 事件环境下的兜底（capture 保证先于 body 委托）
  document.addEventListener('click', function (e) {
    var icon = iconOf(e);
    if (!icon || icon.__hgTapOk) return;
    if (typeof window.__deskIconTapRecall === 'function') window.__deskIconTapRecall(icon);
  }, true);
})();

// 桌面图标被「明确点击」时的召回回调。
// 背景：body 上的委托用「位移 >15px 视为滑动」过滤点击，而滑动翻页的 touchmove 拦截器
// 又可能在真机上把这一次的 click 合成取消掉 —— 表现就是「点图标完全没反应」。
// 这里给图标一条直连路径，并且把每一次打开尝试的失败原因暴露出来（不再静默）。
window.__deskIconTapRecall = function (iconEl) {
  if (!iconEl) return;
  // 位移判定显式放行（仅对这一次点击）
  iconEl.__hgTapOk = true;
  var appId = iconEl.getAttribute("data-app");
  if (!appId) { iconEl.__hgTapOk = false; return; }
  // 编辑模式下点击图标依然只用于退出编辑，不在这里打开应用
  if (typeof isDesktopEditMode !== 'undefined' && isDesktopEditMode) {
    // 但绝不能让「停在编辑模式」变成「所有图标都点不动」这种死局：
    // 第一次点直接退出编辑并明确告知，第二次点就正常打开。
    try {
      if (typeof exitDesktopEditMode === 'function') exitDesktopEditMode();
      if (typeof window.showToast === 'function') {
        window.showToast('已退出桌面编辑模式，再点一次就能打开「' + appId + '」');
      }
    } catch (e) { }
    iconEl.__hgTapOk = false;
    return;
  }
  // 已被拖拽固定的图标不触发（与原委托行为一致）
  if (iconEl.style && iconEl.style.position === "fixed") { iconEl.__hgTapOk = false; return; }
  // 轻量诊断：记下每一次图标点击尝试，方便用户反馈「点了没反应」时定位
  try {
    window.__hgDeskTapLog = window.__hgDeskTapLog || [];
    window.__hgDeskTapLog.push({ app: appId, at: Date.now() });
    if (window.__hgDeskTapLog.length > 40) window.__hgDeskTapLog.shift();
  } catch (e) { }
  try {
    if (typeof window.openApp !== "function") {
      throw new Error("openApp 未就绪（路由脚本可能没加载成功）");
    }
    window.openApp(appId);
    // 打开后确认窗口真的显示出来了；没显示就把原因说出来，避免再次「静默失败」
    setTimeout(function () {
      var w = document.getElementById("win-" + appId);
      if (!w) {
        console.warn("[Desktop] 找不到 #win-" + appId + "，该应用页可能未注册");
        if (typeof window.showToast === "function") {
          window.showToast("「" + appId + "」页面不存在（#win-" + appId + " 未注册）");
        }
        return;
      }
      if (!w.classList.contains("active")) {
        console.warn("[Desktop] 调用了 openApp('" + appId + "') 但窗口没有激活");
        if (typeof window.showToast === "function") {
          window.showToast("「" + appId + "」没能打开（窗口未激活）");
        }
      }
    }, 120);
  } catch (err) {
    console.error("[Desktop] 直连开应用失败:", appId, err);
    if (typeof window.showToast === "function") {
      window.showToast("打开「" + appId + "」失败：" + (err && err.message ? err.message : err));
    }
  }
  // 消费掉这次点击，避免同一次冒泡里再走一遍委托
  setTimeout(function () { try { iconEl.__hgTapOk = false; } catch (e) { } }, 0);
};

function initAppClickEvents() {
  if (isAppClickEventsInitialized) return;
  isAppClickEventsInitialized = true;

  document.body.addEventListener("click", (e) => {
    // 兜底：如果图标自己的 onclick 已经明确表示「这是一次点击（不是滑动）」，
    // 就跳过位移判定，避免触屏环境下点击被吞掉。
    const dist = (e.target.closest && e.target.closest(".app-icon") && e.target.closest(".app-icon").__hgTapOk)
      ? 0
      : Math.hypot(e.clientX - lastPointerDownX, e.clientY - lastPointerDownY);
    if (dist > 15) return;

    // 编辑模式下，点击任何外部区域自动安全退出编辑模式
    if (isDesktopEditMode) {
      if (!e.target.closest(".widget-add-badge") && !e.target.closest(".widget-delete-badge") && !e.target.closest(".app-icon")) {
        exitDesktopEditMode();
        return;
      }
    }

    const icon = e.target.closest(".app-icon");
    if (icon) {
      // 图标自己的 onclick 已经直连打开过了（见 window.__deskIconTapRecall），
      // 这里只清理标记，不再重复 openApp。
      if (icon.__hgTapOk) { try { icon.__hgTapOk = false; } catch (e2) { } return; }
      const app = icon.getAttribute("data-app");
      // 仅当图标没有处于被拖拽移动的状态时，才触发应用开启
      if (icon.style.position !== "fixed") {
        openApp(app);
      }
    }
  });
}

function openApp(app) {
  const win = document.getElementById(`win-${app}`);
  if (win) {
    // 跳转前先关闭其他所有 active 的应用窗口（等同于先回主页面再跳转目标页）
    // 修复层级问题：从聊天点档案馆/深谈跳不过去、小助手全屏被遮挡等
    document.querySelectorAll(".app-window.active").forEach(function (w) {
      if (w !== win) w.classList.remove("active");
    });
    win.classList.add("active");
    updateThemeColor("#f4f6fa");
    
    // 安全防御：在全局环境检测初始化函数是否存在，100% 避免 reference 报错引发的脚本假死
    if (app === 'settings' && typeof initSettingsApp === 'function') initSettingsApp();
    if (app === 'archive' && typeof initArchiveApp === 'function') initArchiveApp();
    if (app === 'world_book' && typeof initWorldBookApp === 'function') initWorldBookApp(); 
    if (app === 'chat' && typeof initChatApp === 'function') initChatApp();
    if (app === 'deeptalk' && typeof initDeeptalkApp === 'function') initDeeptalkApp();
    if (app === 'reader' && typeof initReaderApp === 'function') initReaderApp();
    if (app === 'forum' && typeof initForumApp === 'function') initForumApp();
    if (app === 'couples' && typeof initCouplesApp === 'function') initCouplesApp();
    if (app === 'music' && typeof initMusicApp === 'function') initMusicApp();
    if (app === 'shopping' && typeof initShoppingApp === 'function') initShoppingApp();
    if (app === 'encounter' && typeof initEncounterApp === 'function') initEncounterApp();
    if (app === 'quicktravel' && typeof initQuickTravelApp === 'function') initQuickTravelApp();
    if (app === 'workbench' && typeof initWorkbenchApp === 'function') initWorkbenchApp();
    if (app === 'yigui' && typeof initYiguiApp === 'function') initYiguiApp();
    // 心动游戏 / 占位图标：功能本体由后续窗口实装，这里只在函数存在时调用
    if (app === 'heartgame' && typeof initHeartGameApp === 'function') initHeartGameApp();
    if (app === 'placeholder' && typeof initPlaceholderApp === 'function') initPlaceholderApp();
  }
}

function closeApp(app) {
  const win = document.getElementById(`win-${app}`);
  if (win) {
    win.classList.remove("active");
    updateThemeColor("#f4f6fa");
  }
}

// 采用 Pointer Events 触控/鼠标完美居中跟手拖拽及双向换位
function initDragEvents() {
  if (isDragEventsInitialized) return;
  isDragEventsInitialized = true;

  let activeIcon = null;
  let startX = 0;
  let startY = 0;
  let lastMoveX = 0; // 动态变量：记录手指最新的移动坐标，破解闭包限制
  let lastMoveY = 0;
  let iconStartX = 0;
  let iconStartY = 0;
  let rectWidth = 0;
  let rectHeight = 0;
  let isDragging = false;
  let originalParent = null;
  let dragPlaceholder = null;
  let longPressTimer = null; // 用于侦测长按阶段1 (1s)
  let longPressTimer2 = null; // 用于侦测长按阶段2 (0.5s)
  let longPressTarget = null; // 缓存当前长按的DOM节点以进行视觉反馈

  document.addEventListener("pointerdown", (e) => {
        const icon = e.target.closest(".app-icon");
        const widget = e.target.closest(".desktop-widget-container");

        // 1. 如果不在编辑模式，只侦测长按以进入编辑模式，绝对不触发拖拽
        if (!isDesktopEditMode) {
          if (longPressTimer) clearTimeout(longPressTimer);
          if (longPressTimer2) clearTimeout(longPressTimer2);
          if (longPressTarget) {
            longPressTarget.style.transform = "";
            longPressTarget.style.transition = "";
            longPressTarget = null;
          }

          if (icon || widget) {
            startX = e.clientX;
            startY = e.clientY;
            lastMoveX = e.clientX; // 初始化最新坐标
            lastMoveY = e.clientY;
            longPressTarget = icon || widget;
            
            // 改进：单级高抗干扰定时器，1.2秒后直接校验动态位移决定是否进入编辑模式
            longPressTimer = setTimeout(() => {
              const dx = lastMoveX - startX;
              const dy = lastMoveY - startY;
              // 容差过滤：手指位移小于10px才判定为真长按，避免误触
              if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !isDesktopEditMode) {
                enterDesktopEditMode();
              }
              longPressTimer = null;
            }, 1200);
          }
          return; // 拦截！未进入编辑模式时，严禁初始化任何拖动及变量赋值
        }

        // 2. 如果已经在编辑模式，直接触发拖动重排逻辑，且无需重复侦测长按
        if (!icon) return;
        
        // 核心安全防御：若图标此时已脱离网格存在于 body 层（如上一次拖拽非正常中断），绝对拦截其重入 pointerdown
        const parentSlot = icon.parentNode;
        if (!parentSlot || (!parentSlot.classList.contains("desktop-slot") && !parentSlot.classList.contains("dock-slot"))) {
          return;
        }

        activeIcon = icon;
        
        if (e.target.setPointerCapture) {
          e.target.setPointerCapture(e.pointerId);
        }

        const rect = activeIcon.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        iconStartX = rect.left;
        iconStartY = rect.top;
        rectWidth = rect.width;
        rectHeight = rect.height;
        originalParent = activeIcon.parentNode;
        isDragging = false;
      });

  document.addEventListener("pointermove", (e) => {
    // 持续向动态变量投递最新的坐标，解决定时器闭包只取旧值的问题
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // 改进：一旦位移超出颤动阈值（10px），立刻在滑动第一步销毁定时器，防止事件漏发
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (longPressTimer2) {
        clearTimeout(longPressTimer2);
        longPressTimer2 = null;
      }
      if (longPressTarget) {
        longPressTarget.style.transform = "";
        longPressTarget.style.transition = "";
        longPressTarget = null;
      }
    }

    if (!activeIcon) return;

    if (!isDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isDragging = true;
      activeIcon.classList.add("dragging");

      // 建立占位符，防止网格崩塌
      dragPlaceholder = document.createElement("div");
      dragPlaceholder.className = "app-icon-placeholder";
      dragPlaceholder.style.width = rectWidth + "px";
      dragPlaceholder.style.height = rectHeight + "px";
      originalParent.insertBefore(dragPlaceholder, activeIcon);

      // 核心修复：开启拖动时，将图标临时剪切追加到 #phone-container 顶层图层上！
      // 这将完美避开 Dock 栏 .dock-container 的 backdrop-filter 的 Containing Block 限制
      // 同时也避开了 body 层 flexbox 布局对图标尺寸的强制拉伸，一箭双雕！
      const phoneContainer = document.getElementById("phone-container");
      if (phoneContainer) {
        phoneContainer.appendChild(activeIcon);
      }

      activeIcon.style.position = "absolute";
      activeIcon.style.width = (rectWidth || 72) + "px"; // 跟随当前网格格子宽度（4 列 × 7 行自适应）
      activeIcon.style.height = "auto";
      activeIcon.style.zIndex = "9999";
      activeIcon.style.pointerEvents = "none"; 
    }

    if (isDragging) {
      // 核心优化：让图标 1:1 结合 #phone-container 的绝对坐标，实现高精度非弹性跟随
      const phoneContainer = document.getElementById("phone-container");
      const phoneRect = phoneContainer ? phoneContainer.getBoundingClientRect() : { left: 0, top: 0 };
      const halfW = (rectWidth || 72) / 2;
      const halfH = (rectHeight || 84) / 2;
      activeIcon.style.left = (e.clientX - phoneRect.left - halfW) + "px";
      activeIcon.style.top = (e.clientY - phoneRect.top - halfH) + "px";

      // 动态获取划过处的网格槽
      const targetElement = document.elementFromPoint(e.clientX, e.clientY);
      let hoveredSlot = null;
      if (targetElement) {
        hoveredSlot = targetElement.closest(".desktop-slot") || targetElement.closest(".dock-slot");
      }

      // 重置并单独给悬停网格槽添加微亮指示器
      document.querySelectorAll(".desktop-slot, .dock-slot").forEach(slot => {
        slot.classList.remove("drag-over");
      });

      if (hoveredSlot) {
        hoveredSlot.classList.add("drag-over");
      }
    }
  });

  document.addEventListener("pointerup", (e) => {
        if (longPressTimer) clearTimeout(longPressTimer);
        if (longPressTimer2) clearTimeout(longPressTimer2);
        if (longPressTarget) {
          longPressTarget.style.transform = "";
          longPressTarget.style.transition = "";
          longPressTarget = null;
        }
        if (!activeIcon) return;

        if (isDragging) {
          activeIcon.classList.remove("dragging");
          if (dragPlaceholder) {
            dragPlaceholder.remove();
          }

          // 精确获取落点处的网格槽
          const targetElement = document.elementFromPoint(e.clientX, e.clientY);
          let dropSlot = null;
          if (targetElement) {
            dropSlot = targetElement.closest(".desktop-slot") || targetElement.closest(".dock-slot");
          }

          // 清空所有的槽位高亮
          document.querySelectorAll(".desktop-slot, .dock-slot").forEach(slot => {
            slot.classList.remove("drag-over");
          });

          // 还原所有的 inline 拖拽尺寸和定位属性
          activeIcon.style.position = "";
          activeIcon.style.width = "";
          activeIcon.style.height = "";
          activeIcon.style.left = "";
          activeIcon.style.top = "";
          activeIcon.style.zIndex = "";
          activeIcon.style.pointerEvents = "";

          if (dropSlot) {
            const existingIcon = dropSlot.querySelector(".app-icon");
            const existingWidget = dropSlot.querySelector(".desktop-widget-container");

            // 槽位上如果是已存在图标，进行互互相对调；如果是代码组件，禁止对调回归原位
            if (existingIcon) {
              originalParent.appendChild(existingIcon);
              dropSlot.appendChild(activeIcon);
            } else if (existingWidget) {
              originalParent.appendChild(activeIcon);
            } else {
              dropSlot.appendChild(activeIcon);
            }
            saveLayoutsToLocal();
            loadDesktopLayout(); // 存盘后立刻重绘网格，消除残存DOM状态与增殖冗余
          } else {
            originalParent.appendChild(activeIcon);
            loadDesktopLayout(); // 归位后立即进行自愈式网格重绘
          }
        }

        activeIcon = null;
        isDragging = false;
        dragPlaceholder = null;
      });

  // 安全防御：当系统发出硬件或系统级的 pointercancel 信号时，必须安全销毁并还原所有进行中的长按定时器和拖拽状态
  document.addEventListener("pointercancel", (e) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (longPressTimer2) {
      clearTimeout(longPressTimer2);
      longPressTimer2 = null;
    }
    if (longPressTarget) {
      longPressTarget.style.transform = "";
      longPressTarget.style.transition = "";
      longPressTarget = null;
    }
    if (activeIcon) {
      if (isDragging) {
        activeIcon.classList.remove("dragging");
        if (dragPlaceholder) {
          dragPlaceholder.remove();
        }
        // 还原所有的拖拽 inline 属性并安全归位，打消由于手势中断引发的图标凭空丢失
        activeIcon.style.position = "";
        activeIcon.style.width = "";
        activeIcon.style.height = "";
        activeIcon.style.left = "";
        activeIcon.style.top = "";
        activeIcon.style.zIndex = "";
        activeIcon.style.pointerEvents = "";
        originalParent.appendChild(activeIcon);
        loadDesktopLayout();
      }
      activeIcon = null;
      isDragging = false;
      dragPlaceholder = null;
    }
  });
}

// 桌面滑屏翻页控制引擎 (一次仅翻一页)
function initDesktopSwipeEvents() {
  const desktop = document.getElementById("desktop");
  if (!desktop) return;

  let swipeStartX = 0;
  let swipeStartY = 0;
  let isSwipingDesktop = false;

  desktop.addEventListener("pointerdown", (e) => {
    // 编辑模式下才过滤图标和组件（因为需要拖拽），普通模式下允许从图标上开始滑动翻页
    if (isDesktopEditMode) {
      if (
        e.target.closest(".app-icon") || 
        e.target.closest(".desktop-widget-container") || 
        e.target.closest("button") || 
        e.target.closest(".widget-add-badge") || 
        e.target.closest(".widget-delete-badge")
      ) {
        return;
      }
    } else {
      // 普通模式下仅过滤点击按钮
      if (
        e.target.closest("button") || 
        e.target.closest(".widget-add-badge") || 
        e.target.closest(".widget-delete-badge")
      ) {
        return;
      }
    }
    isSwipingDesktop = true;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
  });

  // 改在 document 上全局监听 pointerup 和 pointercancel，彻底解决滑动出界、滑动到其他节点上导致 pointerup 不触发的顽疾！
  document.addEventListener("pointerup", (e) => {
    if (!isSwipingDesktop) return;
    isSwipingDesktop = false;

    const deltaX = e.clientX - swipeStartX;
    const deltaY = e.clientY - swipeStartY;

    // 严防斜向无意识滑动干扰，限制 Y 轴偏离值在安全容错范围内
    if (Math.abs(deltaY) < 80) {
      let desktopLayout = [];
      try {
        desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3")) || [];
      } catch (err) {}
      const pageCount = Math.max(1, Math.ceil(desktopLayout.length / DESKTOP_PAGE_SIZE));

      if (deltaX < -50) {
        // 向左滑 -> 进入下一页
        if (currentDesktopPage < pageCount - 1) {
          currentDesktopPage++;
          loadDesktopLayout();
        }
      } else if (deltaX > 50) {
        // 向右滑 -> 进入上一页
        if (currentDesktopPage > 0) {
          currentDesktopPage--;
          loadDesktopLayout();
        }
      }
    }
  });

  // 核心阻断：向整个桌面绑定 touchmove 的拦截器，并强行阻断默认回弹，确保真机 pointermove 的手势事件不被系统蚕食丢包 [1]
  // ⚠ 关键修正（v1.5.25）：只有在「确实横滑超过阈值」时才 preventDefault。
  //   旧写法一进入 isSwipingDesktop 就无条件 preventDefault，而 isSwipingDesktop 在
  //   pointerdown 时只要不是点在 button/badge 上就立刻置 true ——
  //   于是**任何**触摸都会在第一次 touchmove（哪怕只抖了 1~2px）时取消默认行为。
  //   浏览器一旦在 touchmove 上 preventDefault，这次的 click 就永远不会被合成
  //   —— 表现就是「点图标完全没反应、也不报错」。这就是根因。
  desktop.addEventListener("touchmove", (e) => {
    if (!isSwipingDesktop) return;
    if (!e.touches || !e.touches[0]) return;
    const dx = Math.abs(e.touches[0].clientX - swipeStartX);
    const dy = Math.abs(e.touches[0].clientY - swipeStartY);
    // 横滑明显、且纵向没有大偏离，才算真正的翻页手势
    if (dx > 10 && dx > dy) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("pointercancel", () => {
    isSwipingDesktop = false;
  });
}

function saveLayoutsToLocal() {
  const desktopSlots = Array.from(document.getElementById("desktop-grid").children);
  let desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3")) || [];
  const pageCount = Math.max(1, Math.ceil(desktopLayout.length / DESKTOP_PAGE_SIZE));
  
  while (desktopLayout.length < pageCount * DESKTOP_PAGE_SIZE) {
    desktopLayout.push(null);
  }

  const pageStart = currentDesktopPage * DESKTOP_PAGE_SIZE;
  for (let i = 0; i < DESKTOP_PAGE_SIZE; i++) {
    desktopLayout[pageStart + i] = null;
  }
  
  // === 【物理对齐存盘校正】：通过 slot 的 data-index 属性反查真实索引，防止由于跳过 DOM 节点导致的整体缩水 ===
  desktopSlots.forEach(slot => {
    const index = parseInt(slot.getAttribute("data-index"));
    if (!isNaN(index) && index < DESKTOP_PAGE_SIZE) {
      const icon = slot.querySelector(".app-icon");
      desktopLayout[pageStart + index] = icon ? icon.getAttribute("data-app") : null;
    }
  });

  const dockSlots = Array.from(document.getElementById("dock-grid").children);
  const dockLayout = Array(4).fill(null);
  dockSlots.forEach(slot => {
    const index = parseInt(slot.getAttribute("data-index"));
    if (!isNaN(index) && index < 4) {
      const icon = slot.querySelector(".app-icon");
      dockLayout[index] = icon ? icon.getAttribute("data-app") : null;
    }
  });

  // 独立保存高吸附性网格版本的布局数据
  localStorage.setItem("desktop-layout-v3", JSON.stringify(desktopLayout));
  localStorage.setItem("dock-layout-v3", JSON.stringify(dockLayout));
}

// ==========================================
// 桌面编辑模式控制中心与组件动态增/删逻辑
// ==========================================
function enterDesktopEditMode() {
  if (isDesktopEditMode) return;
  isDesktopEditMode = true;
  const phone = document.getElementById("phone-container");
  if (phone) {
    phone.classList.add("edit-mode");
  }
  loadDesktopLayout();
}

function exitDesktopEditMode() {
  isDesktopEditMode = false;
  const phone = document.getElementById("phone-container");
  if (phone) {
    phone.classList.remove("edit-mode");
  }
  loadDesktopLayout();
}

// 判断某个系统应用是否已经被摆放在桌面或 Dock 栏，防止重复实例增殖
function isAppAlreadyPlaced(appId) {
  let desktopLayout = [];
  let dockLayout = [];
  try {
    desktopLayout = JSON.parse(localStorage.getItem("desktop-layout-v3")) || [];
    dockLayout = JSON.parse(localStorage.getItem("dock-layout-v3")) || [];
  } catch(e) {}
  return desktopLayout.includes(appId) || dockLayout.includes(appId);
}

// 唤起选择添加系统应用或小部件的选择弹层 (去 Emoji，全 SVG 美化)
function openAddSelector(type, slotIndex) {
  let widgets = {};
  try {
    widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
  } catch(e) {}

  const widgetIds = Object.keys(widgets);
  const appsList = ["encounter", "settings", "archive", "world_book", "chat", "deeptalk", "reader", "forum", "couples", "music", "shopping", "quicktravel", "workbench", "yigui", "heartgame", "placeholder"];

  let html = `<div style="padding:16px;">
    <h4 style="margin:0 0 12px;font-size:14px;font-weight:700;text-align:center;">选择要添加的内容</h4>

    <!-- 1. 系统应用摆放 -->
    <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px; max-height:120px; overflow-y:auto;">`;

  let appAddedCount = 0;
  appsList.forEach(appId => {
    if (!isAppAlreadyPlaced(appId)) {
      let name = "";
      if (appId === "settings") name = "设置";
      else if (appId === "archive") name = "档案库";
      else if (appId === "world_book") name = "世界书";
      else if (appId === "chat") name = "聊天";
      else if (appId === "deeptalk") name = "深谈";
      else if (appId === "reader") name = "阅读";
      else if (appId === "forum") name = "论坛";
      else if (appId === "couples") name = "情侣空间";
      else if (appId === "music") name = "听歌";
      else if (appId === "shopping") name = "购物";
      else if (appId === "encounter") name = "邂逅";
      else if (appId === "quicktravel") name = "快穿局";
      else if (appId === "workbench") name = "工作台";
      else if (appId === "yigui") name = "仪轨";
      else if (appId === "heartgame") name = "心动游戏";
      else if (appId === "placeholder") name = "占位图标";

      html += `
        <button onclick="placeAppOnSlot('${type}', ${slotIndex}, '${appId}')" style="width:100%; padding:8px 10px; border-radius:10px; border:1px solid #e2e8f0; background:#f8fafc; font-size:12px; font-weight:600; text-align:left; cursor:pointer; display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>
          ${name}
        </button>
      `;
      appAddedCount++;
    }
  });

  if (appAddedCount === 0) {
    html += `<div style="text-align:center; font-size:11px; color:#94a3b8; padding:10px 0;">所有系统应用都已摆放在桌面上</div>`;
  }

  html += `</div>
    
    <!-- 2. 自定义桌面组件 -->
    <div style="font-size:11px; font-weight:700; color:var(--text-secondary); margin-bottom:6px; border-bottom:1px solid #f1f5f9; padding-bottom:2px;">添加组件工坊小部件</div>
    <div style="display:flex; flex-direction:column; gap:6px; max-height:150px; overflow-y:auto;">`;

  if (widgetIds.length === 0) {
    html += `<div style="text-align:center; font-size:11px; color:#94a3b8; padding:10px 0;">暂无组件，请去设置内创建</div>`;
  } else {
    widgetIds.forEach(id => {
      html += `
        <button onclick="placeWidgetOnSlot('${type}', ${slotIndex}, '${id}')" style="width:100%; padding:8px 10px; border-radius:10px; border:1px solid #e2e8f0; background:#f8fafc; font-size:12px; font-weight:600; text-align:left; cursor:pointer; display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;"><path fill="currentColor" d="M12 2L2 7l10 5 10-5-10-5zM2 9v7.5c0 .8.6 1.5 1.4 1.7l8.6 3.1v-7.3L2 9zm18 0l-10 5v7.3l8.6-3.1c.8-.2 1.4-.9 1.4-1.7V9z"/></svg>
          ${widgets[id].name} (${widgets[id].widthSpan || 1}x${widgets[id].heightSpan || 1})
        </button>
      `;
    });
  }

  html += `</div>
    <button onclick="closeWidgetSelectorModal()" style="margin-top:14px; width:100%; padding:10px; border-radius:10px; border:none; background:#ef4444; color:white; font-size:12px; font-weight:600; cursor:pointer;">取消</button>
  </div>`;

  let overlay = document.getElementById("widget-select-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "widget-select-overlay";
    overlay.className = "modal-overlay";
    document.getElementById("phone-container").appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal" style="max-width:300px; border-radius:16px; margin:auto; background:white;">${html}</div>`;
  overlay.classList.add("active");
}

window.placeAppOnSlot = function(type, slotIndex, appId) {
  try {
    let layout = JSON.parse(localStorage.getItem(`${type}-layout-v3`)) || Array(type === "desktop" ? DESKTOP_PAGE_SIZE : 4).fill(null);
    const realIndex = type === "desktop" ? (currentDesktopPage * DESKTOP_PAGE_SIZE + slotIndex) : slotIndex;
    while (layout.length <= realIndex) {
      layout.push(null);
    }
    layout[realIndex] = appId;
    localStorage.setItem(`${type}-layout-v3`, JSON.stringify(layout));
  } catch(e) {}
  
  closeWidgetSelectorModal();
  exitDesktopEditMode();
};

window.placeWidgetOnSlot = function(type, slotIndex, widgetId) {
  try {
    const placed = JSON.parse(localStorage.getItem(`placed-widgets-${type}`)) || {};
    const realIndex = type === "desktop" ? (currentDesktopPage * DESKTOP_PAGE_SIZE + slotIndex) : slotIndex;
    placed[realIndex] = widgetId;
    localStorage.setItem(`placed-widgets-${type}`, JSON.stringify(placed));
  } catch(e) {}
  
  closeWidgetSelectorModal();
  exitDesktopEditMode();
};

window.closeWidgetSelectorModal = function() {
  const overlay = document.getElementById("widget-select-overlay");
  if (overlay) overlay.classList.remove("active");
};

function removeWidgetFromSlot(type, slotIndex) {
  if (confirm("确定要从该网格中删除此组件吗？")) {
    try {
      const placed = JSON.parse(localStorage.getItem(`placed-widgets-${type}`)) || {};
      const realIndex = type === "desktop" ? (currentDesktopPage * DESKTOP_PAGE_SIZE + slotIndex) : slotIndex;
      delete placed[realIndex];
      localStorage.setItem(`placed-widgets-${type}`, JSON.stringify(placed));
    } catch(e) {}
    exitDesktopEditMode();
  }
}

function removeAppFromSlot(type, slotIndex) {
  if (confirm("确定要将此应用从当前槽位中移除吗？您随时可以长按点击空白网格的加号重新放回桌面。")) {
    try {
      let layout = JSON.parse(localStorage.getItem(`${type}-layout-v3`)) || Array(type === "desktop" ? DESKTOP_PAGE_SIZE : 4).fill(null);
      const realIndex = type === "desktop" ? (currentDesktopPage * DESKTOP_PAGE_SIZE + slotIndex) : slotIndex;
      while (layout.length <= realIndex) {
        layout.push(null);
      }
      layout[realIndex] = null;
      localStorage.setItem(`${type}-layout-v3`, JSON.stringify(layout));
    } catch(e) {}
    exitDesktopEditMode();
  }
}

// 绑定阅读应用专属退出逻辑
function closeReaderRoom() {
  if (window.readerSystem && window.readerSystem.exitReadingRoom) {
    window.readerSystem.exitReadingRoom();
  }
}

// ============================================================
//  修复：编辑组件文字（contenteditable，如拍立得标题）时，
//  浏览器会自动滚动焦点元素到可见位置，导致 #desktop 向上抬起且无法恢复。
//  在聚焦后立即恢复桌面滚动位置，保证桌面纹丝不动。
// ============================================================
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (!t || !t.isContentEditable) return;
  const scroller = document.getElementById("desktop");
  if (!scroller) return;
  const saved = scroller.scrollTop;
  // 浏览器在聚焦默认动作阶段才会执行自动滚动，故在下一帧（滚动完成后）恢复原位
  requestAnimationFrame(() => {
    if (scroller.scrollTop !== saved) scroller.scrollTop = saved;
  });
});
