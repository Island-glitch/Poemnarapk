/**
 * app_desktop_guard.js - 桌面自检守卫（v1.5.51）
 * ============================================================================
 * 为什么需要它（真实事故）：
 *   老版本升到新版本时，桌面美化参数是存在 localStorage 里的。旧档里的
 *   `beautify-desktop-scale`（桌面整体放缩）在新布局上会把 #dock 用
 *   `transform: scale()` 推出可视区，而**设置入口正好在 #dock 里** ——
 *   于是用户既看不到底栏、也打不开设置，陷入无法自救的死锁。
 *   （transform 只影响绘制、不影响排版，所以 DOM 量出来"存在"，但屏幕上没有。）
 *
 * 它做什么：
 *   1. 自检：等桌面真正渲染出来后，量 #desktop / #dock 的真实矩形，
 *      判断「底栏可见吗」「桌面图标画出来了吗」「设置入口够得着吗」；
 *   2. 自救：命中问题时，在最上层弹一条自检条，**一键应用默认 UI（薄秋）**
 *      并清掉遗留的缩放/偏移，然后刷新；
 *   3. 留证：把量到的数据写进 localStorage（`desktop-guard-last`）并打到控制台，
 *      下次再出问题可以直接看这一条，不用再猜。
 *
 * 设计约束：
 *   - 纯经典脚本：无 TS / JSX / import，无 emoji，无原生 alert/confirm/prompt；
 *   - 不依赖心动游戏内核（H/K），全部自绘内联样式，保证在任何页面状态下都能显示；
 *   - 只在主界面真正可见时才判定，避免把启动过程误判成桌面故障；
 *   - 只提示、不擅自改用户数据：真正的修复动作必须由用户点一下才执行。
 */
(function () {
  'use strict';

  var LOG_KEY = 'desktop-guard-last';
  var BANNER_ID = 'desktop-guard-banner';
  var MAX_CHECKS = 26;          // 最多自检次数（约 13 秒）
  var CHECK_EVERY_MS = 500;

  var checks = 0;
  var done = false;
  var lastReport = null;

  function $(id) { return document.getElementById(id); }

  function rectOf(el) {
    if (!el) return null;
    var b = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    return {
      x: Math.round(b.x), y: Math.round(b.y),
      w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom),
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      transform: cs.transform === 'none' ? '' : cs.transform
    };
  }

  /** 桌面已经渲染：否则先不自检 */
  function desktopIsLive() {
    var phone = $('phone-container');
    if (!phone) return false;
    if (window.getComputedStyle(phone).display === 'none') return false;
    var splash = $('boot-splash');
    if (splash && window.getComputedStyle(splash).display !== 'none') return false;
    return true;
  }

  /** 收集一次现场数据（无论好坏都记，便于排查） */
  function collect() {
    var dock = $('dock');
    var dockGrid = $('dock-grid');
    var desktop = $('desktop');
    var grid = $('desktop-grid');

    var dockIcons = dockGrid ? dockGrid.querySelectorAll('.app-icon').length : 0;
    var desktopIcons = grid ? grid.querySelectorAll('.app-icon').length : 0;
    var inDock = function (app) {
      return !!(dockGrid && dockGrid.querySelector('.app-icon[data-app="' + app + '"]'));
    };
    var inDesktop = function (app) {
      return !!(grid && grid.querySelector('.app-icon[data-app="' + app + '"]'));
    };

    var store = function (k, d) { try { return localStorage.getItem(k); } catch (e) { return d; } };

    return {
      at: Date.now(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      phone: rectOf($('phone-container')),
      desktop: rectOf(desktop),
      grid: rectOf(grid),
      dock: rectOf(dock),
      dockGrid: rectOf(dockGrid),
      dockIcons: dockIcons,
      desktopIcons: desktopIcons,
      settingsReachable: inDock('settings') || inDesktop('settings'),
      chatReachable: inDock('chat') || inDesktop('chat'),
      // 遗留参数（事故的直接来源）
      stashed: {
        desktopScale: store('beautify-desktop-scale', null),
        desktopOffset: store('beautify-desktop-offset', null),
        dockOpacity: store('beautify-dock-opacity', null),
        metrics: store('beautify-desktop-metrics', null),
        injectedCssLen: (store('beautify-active-css', '') || '').length
      },
      dockInlineStyle: dock ? (dock.getAttribute('style') || '') : null
    };
  }

  /** 判定问题；返回问题码数组 */
  function judge(r) {
    var problems = [];
    var vh = r.viewport.h;

    // ★ 只认「明确坏掉」的情况。宁可漏报，也不要在用户自己排好的桌面上乱弹。
    //
    // 为什么不做这些判定（踩过的思考）：
    //   · "桌面图标太少" —— 用户可以自己把图标都收进 dock，不该报；
    //   · "设置不在 dock 里" —— 用户可能故意把设置放到桌面页码上，不该报；
    //   · "底栏露出得少" —— 浏览器底栏遮挡无法测量，阈值容易误伤正常机型。
    // 这些都是「诊断信息」，写进日志，但不触发提示。

    var dg = r.dockGrid;
    var df = r.dock;

    if (!df || !dg) {
      problems.push('dock-missing');
    } else if (dg.h > 0) {
      if (dg.y >= vh) problems.push('dock-below-viewport');          // 整条落在视口下方
      else if (dg.bottom <= 0) problems.push('dock-above-viewport'); // 整条被顶到视口上方
    } else if (r.dockIcons > 0) {
      // 有图标却量出来高度为 0：布局塌了（典型是 scale/偏移把父层压扁）
      problems.push('dock-collapsed');
    }

    return problems;
  }

  function remember(report, problems, ok) {
    lastReport = report;
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify({
        at: report.at, ok: ok, problems: problems,
        viewport: report.viewport, desktop: report.desktop, dock: report.dock,
        dockGrid: report.dockGrid, dockIcons: report.dockIcons,
        desktopIcons: report.desktopIcons,
        settingsReachable: report.settingsReachable, stashed: report.stashed,
        dockInlineStyle: report.dockInlineStyle
      }));
    } catch (e) { }
    try {
      console.log('[桌面自检] ' + (ok ? '通过' : '发现问题：' + problems.join(' / ')), report);
    } catch (e) { }
  }

  // ------------------------------------------------------------------
  //  自检条（自绘，不依赖任何模块）
  // ------------------------------------------------------------------
  function removeBanner() {
    var b = $(BANNER_ID);
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function buildBanner(problems) {
    removeBanner();

    var wrap = document.createElement('div');
    wrap.id = BANNER_ID;
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText = 'position:fixed; left:10px; right:10px; bottom:10px; z-index:2147483000;'
      + 'background:linear-gradient(165deg,#fffdfe,#fff5f9 60%,#f7f4ff); border:1.5px solid rgba(217,127,168,0.5);'
      + 'border-radius:18px; box-shadow:0 18px 44px rgba(110,70,100,0.28); padding:13px 14px;'
      + 'font-family:inherit; box-sizing:border-box;';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:13px; font-weight:800; color:#8f4f6d; margin-bottom:6px;';
    title.textContent = '桌面好像没排好，可以一键恢复';
    wrap.appendChild(title);

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:11.4px; line-height:1.72; color:#6f6472; margin-bottom:10px;';
    desc.textContent = '检测到：' + problems.map(describe).join('、')
      + '。这通常是旧版本留下的桌面缩放/偏移造成的，恢复默认界面即可，聊天与档案都不会动。';
    wrap.appendChild(desc);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center;';

    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = '一键恢复默认界面';
    okBtn.style.cssText = 'flex:1; border:none; cursor:pointer; padding:11px 12px; border-radius:13px;'
      + 'font-size:12.5px; font-weight:800; color:#fff; font-family:inherit;'
      + 'background:linear-gradient(135deg,#D97FA8,#B79EDC);'
      + 'box-shadow:0 8px 20px rgba(200,130,180,0.34);';
    okBtn.onclick = function () { recover('default'); };
    row.appendChild(okBtn);

    var fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.textContent = '只修显示';
    fixBtn.style.cssText = 'flex:1; cursor:pointer; padding:11px 12px; border-radius:13px; font-family:inherit;'
      + 'font-size:12.5px; font-weight:800; color:#7d63a8; background:rgba(255,255,255,0.94);'
      + 'border:1.5px solid rgba(183,158,220,0.5);';
    fixBtn.onclick = function () { recover('display-only'); };
    row.appendChild(fixBtn);

    var laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.textContent = '先不用';
    laterBtn.setAttribute('aria-label', '先不用');
    laterBtn.style.cssText = 'cursor:pointer; padding:11px 13px; border-radius:13px; font-family:inherit;'
      + 'font-size:12.5px; font-weight:700; color:#9a8f9e; background:rgba(240,236,244,0.9); border:none;';
    laterBtn.onclick = function () { done = true; removeBanner(); };
    row.appendChild(laterBtn);

    wrap.appendChild(row);

    var tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px; color:#a99fae; margin-top:9px; line-height:1.6;';
    tip.textContent = '「一键恢复默认界面」= 应用内置的「薄秋」主题并清掉缩放/偏移；'
      + '「只修显示」= 只清掉缩放/偏移，保留你现在的主题。两者都会保留聊天、档案与记忆。';
    wrap.appendChild(tip);

    document.body.appendChild(wrap);
  }

  function describe(code) {
    switch (code) {
      case 'dock-below-viewport': return '底部 Dock 栏落在了屏幕下方';
      case 'dock-above-viewport': return '底部 Dock 栏被顶到了屏幕上方';
      case 'dock-collapsed': return '底部 Dock 栏被压扁了';
      case 'dock-missing': return '底部 Dock 栏没有渲染出来';
      default: return code;
    }
  }

  // ------------------------------------------------------------------
  //  恢复
  // ------------------------------------------------------------------
  function clearStaleDisplayKeys() {
    var keys = ['beautify-desktop-scale', 'beautify-desktop-offset'];
    keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { } });
    // 立刻把内联的 scale / translate 抹掉，不必等刷新（刷新前也能看到效果）
    var dock = $('dock');
    if (dock) { dock.style.transform = ''; dock.style.transformOrigin = ''; }
    var desktop = $('desktop');
    if (desktop) { desktop.style.transform = ''; desktop.style.transformOrigin = ''; }
  }

  function bannerText(msg) {
    var b = $(BANNER_ID);
    if (!b) return;
    var t = b.querySelector('div');
    if (t) { t.textContent = msg; t.style.color = '#8f4f6d'; }
  }

  function recover(mode) {
    var report = lastReport ? JSON.parse(JSON.stringify(lastReport)) : {};
    var applied = [];

    clearStaleDisplayKeys();
    applied.push('已清掉桌面缩放/偏移');

    if (mode === 'default') {
      try {
        if (typeof window.applyPresetSilently === 'function') {
          window.applyPresetSilently('thin_autumn');       // 内置默认 UI：叙事诗 · 桌面 (M3) / 薄秋
          applied.push('已应用默认界面「薄秋」');
        } else {
          applied.push('没找到预设接口，只清了显示参数');
        }
      } catch (e) {
        applied.push('应用默认界面失败：' + (e && e.message ? e.message : e));
      }
    } else {
      applied.push('保留你现在的主题');
    }

    try {
      localStorage.setItem(LOG_KEY, JSON.stringify({
        at: Date.now(), ok: true, recovered: mode, applied: applied,
        before: report, problems: report.problems || null
      }));
    } catch (e) { }

    bannerText(applied.join('；') + '。正在刷新…');
    setTimeout(function () { location.reload(); }, 700);
    return applied;
  }

  // ------------------------------------------------------------------
  //  自检调度
  // ------------------------------------------------------------------
  function tick() {
    if (done) return;
    checks++;
    if (!desktopIsLive()) {
      if (checks < MAX_CHECKS) return schedule();
      return;                                  // 一直没进桌面，就不打扰
    }

    var report = collect();
    var problems = judge(report);

    if (!problems.length) {
      remember(report, problems, true);
      done = true;
      return;
    }

    // 再给一次机会（有些机型布局要等首帧/字体加载完），两次都判定为坏才提示
    if (!tick._suspected) {
      tick._suspected = problems;
      report.problems = problems;
      remember(report, problems, false);
      if (checks < MAX_CHECKS) return schedule();
    }

    remember(report, problems, false);
    done = true;
    buildBanner(problems);
  }

  function schedule() {
    setTimeout(tick, CHECK_EVERY_MS);
  }

  function start() {
    // 主界面渲染后 phone-container 才会变成可见：用 MutationObserver 抓住这一刻
    var phone = $('phone-container');
    if (phone && window.MutationObserver) {
      try {
        var mo = new MutationObserver(function () {
          if (desktopIsLive()) { mo.disconnect(); done = false; tick._suspected = null; tick(); }
        });
        mo.observe(phone, { attributes: true, attributeFilter: ['style', 'class'] });
      } catch (e) { }
    }
    // 同时保留固定节奏的自检（覆盖"一进来就已进入桌面"的情况）
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // 暴露给控制台，用户/排查时可以直接手动跑
  window.desktopGuard = {
    check: function () { done = false; tick._suspected = null; checks = 0; tick(); return lastReport; },
    report: function () {
      var report = collect();
      return { problems: judge(report), detail: report };
    },
    recover: recover,
    last: function () { try { return JSON.parse(localStorage.getItem(LOG_KEY)); } catch (e) { return null; } },
    hide: function () { done = true; removeBanner(); return true; }
  };
})();
