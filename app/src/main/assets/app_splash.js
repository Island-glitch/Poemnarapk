/**
 * app_splash.js - 开屏启动动画
 * ------------------------------------------------------------
 * 设计约束（用户要求）：禁止 emoji 图标，只用通用路径 SVG；进度条；动画简单但和谐。
 *
 * 工作机制：
 *  - index.html <body> 顶部内联了 #boot-splash 遮罩（z-index 100000，高于登录遮罩 99999），
 *    因此首帧就能绘制，不会先闪一下主界面。
 *  - 本文件负责：渐进推进进度条 → 应用初始化完成后调用 window.bootSplash.ready() 补满并淡出。
 *  - 兜底：最短展示 1.1s（避免动画被瞬间切走），最长 6s 强制收起（初始化异常也不会卡在开屏）。
 */
(function () {
  'use strict';
  var el = document.getElementById('boot-splash');
  if (!el) return;

  var fill = document.getElementById('boot-splash-bar-fill');
  var MIN_MS = 1100;   // 最短展示时长
  var MAX_MS = 6000;   // 最长兜底
  var startedAt = Date.now();
  var progress = 0;
  var finished = false;

  function setProgress(p) {
    progress = Math.max(progress, Math.min(100, p));
    if (fill) fill.style.width = progress + '%';
  }

  // 渐进推进到 72%（剩下的等 ready 补满，让进度条有"最后一下"的收束感）
  var ticker = setInterval(function () {
    if (finished) return;
    var elapsed = Date.now() - startedAt;
    var target = Math.min(72, (elapsed / MIN_MS) * 72);
    if (target > progress) setProgress(target);
  }, 60);

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(ticker);
    setProgress(100);
    var wait = Math.max(0, MIN_MS - (Date.now() - startedAt));
    setTimeout(function () {
      el.classList.add('boot-splash-hide');
      setTimeout(function () { el.style.display = 'none'; }, 480);
    }, wait + 160);
  }

  window.bootSplash = {
    ready: finish,          // 应用初始化完成（进入桌面）时调用
    fail: finish,           // 初始化异常也要收起，避免卡死
    setProgress: setProgress,
    isActive: function () { return !finished; }
  };

  // 安全兜底
  setTimeout(finish, MAX_MS);
})();
