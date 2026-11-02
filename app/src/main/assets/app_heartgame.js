/**
 * app_heartgame.js - 心动游戏 · 主界面看板与生命周期入口
 * ============================================================================
 * 本文件是整个模组的装配层，把下面五个文件接成一个可运行的应用：
 *   app_heartgame_core.js       —— 状态中枢 K + 自绘 UI 组件库 H
 *   app_heartgame_portraits.js  —— 立绘 / 背景 / 热区涂抹 / 后台管理（window.HeartGame.Portraits）
 *   app_heartgame_gacha.js      —— 抽卡工坊 + 锁脸生图 + 钱包（window.HeartGame.Gacha）
 *   app_heartgame_story.js      —— 主线 VN + 分支树 + 剧情小手机（window.HeartGame.Story）
 *   app_heartgame_quiet.js      —— 静室 + 赠礼 + 双轨 Prompt 注入（window.HeartGame.Quiet）
 *   app_heartgame_panels.js     —— 任务 / 商店 / 牵绊（window.HeartGame.Panels）
 *
 * 界面拓扑（严格按设计稿）：
 *   中部        —— Live2D / 高精度立绘 看板，7 处身体热区触控（戳戳交互）
 *   左上角      —— 角色切换器 + 下拉展开的好感度面板
 *   右上角      —— 透明浮动「切换背景」按钮（呼出平铺式背景切换抽屉）
 *   右侧中下方  —— 竖向玻璃拟态图标组：每日任务 / 商店 / 牵绊 / 主线剧情
 *   右下角      —— 抽卡：大尺寸动态悬浮光晕入口
 *   底部右对齐  —— 退出 | 后台管理 | 立绘管理 | 静室
 *
 * 工程红线：纯经典脚本 / 无 emoji / 无原生 alert·confirm·prompt / 淡彩配色 / LF 换行
 */
(function () {
  'use strict';

  var HG = window.HeartGame;

  // ==========================================================================
  //  0. 占位页工具（保留给「占位图标」应用使用）
  // ==========================================================================

  function renderStubPage(bodyEl, opts) {
    if (!bodyEl) return;
    var config = opts || {};
    var accent = config.accent || '#D97FA8';
    var soft = config.soft || '#FFEBF3';
    var iconSvg = config.icon || '';
    var bullets = Array.isArray(config.bullets) ? config.bullets : [];

    bodyEl.innerHTML =
      '<div style="min-height:100%; box-sizing:border-box; padding:28px 20px 40px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;">'
        + '<div style="width:84px; height:84px; border-radius:26px; background:' + soft + '; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(120,140,190,0.10);">'
          + '<span style="width:42px; height:42px; color:' + accent + '; display:flex;">' + iconSvg + '</span>'
        + '</div>'
        + '<div style="font-size:17px; font-weight:800; color:#4a5364; letter-spacing:0.02em;">' + (config.title || '') + '</div>'
        + '<div style="font-size:12.5px; line-height:1.75; color:#8b93a7; text-align:center; max-width:280px;">' + (config.desc || '') + '</div>'
        + (bullets.length
          ? '<div style="width:100%; max-width:300px; display:flex; flex-direction:column; gap:8px; margin-top:4px;">'
              + bullets.map(function (t) {
                return '<div style="display:flex; align-items:flex-start; gap:8px; background:rgba(255,255,255,0.78); border:1px solid rgba(148,163,184,0.18); border-radius:14px; padding:10px 12px; font-size:11.5px; line-height:1.6; color:#6b7488;">'
                  + '<span style="flex-shrink:0; width:16px; height:16px; border-radius:50%; background:' + soft + '; color:' + accent + '; font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center; margin-top:1px;">·</span>'
                  + '<span>' + t + '</span>'
                + '</div>';
              }).join('')
            + '</div>'
          : '')
        + '<div id="' + (config.mountId || 'heartgame-mount') + '" style="width:100%; max-width:320px; margin-top:6px;"></div>'
        + '<div style="margin-top:8px; font-size:10.5px; color:#aab2c4; letter-spacing:0.04em;">' + (config.footer || '功能开发中') + '</div>'
      + '</div>';
  }

  // ==========================================================================
  //  1. 心动游戏主控
  // ==========================================================================

  var App = {
    initialized: false,
    bound: false,
    mounted: false,
    onlineTimer: null,
    onlineSeconds: 0,
    _dom: null,
    _unsubs: [],

    /**
     * 各页面的氛围底图（v1.5.43，用 gameui-art 生成的竖构图插画）
     * 统一放在 images/heartgame/page/，都是 1024x1536 竖构图，
     * 上面再叠一层浅色蒙版保证内容可读。
     */
    PAGE_BG: {
      lobby: 'url(images/heartgame/page/lobby.jpg)',
      tasks: 'images/heartgame/page/tasks.jpg',
      shop: 'images/heartgame/page/shop.jpg',
      bond: 'images/heartgame/page/bond.jpg'
    },

    /**
     * 八个系统入口的图标（v1.5.46）
     * 用户：「生成白底图然后扣成透明底放上去，不要那个背景，也不要外面那个框框。」
     * 所以这里是**透明底 PNG**，界面只用图标本身 + 一行小字，不再有底板与外框。
     */
    ENTRY_BG: {
      task: 'images/heartgame/icon/task.png',
      shop: 'images/heartgame/icon/shop.png',
      bond: 'images/heartgame/icon/bond.png',
      story: 'images/heartgame/icon/story.png',
      exit: 'images/heartgame/icon/exit.png',
      admin: 'images/heartgame/icon/admin.png',
      portrait: 'images/heartgame/icon/portrait.png',
      quiet: 'images/heartgame/icon/quiet.png'
    },

    // ------------------------------------------------------------------
    //  1.1 启动
    // ------------------------------------------------------------------

    /**
     * 入口（openApp('heartgame') → initHeartGameApp()）
     * 幂等：多次打开只重建视图，不重复绑定全局事件
     */
    boot: async function () {
      var closeBtn = document.getElementById('heartgame-close-btn');
      if (closeBtn) {
        // 关闭按钮直接接线全局 closeApp('heartgame')；
        // 资源释放由 bindLifecycle() 里包住的 closeApp 与 MutationObserver 兜底完成。
        // v1.5.35：在独立页面里，这颗左上角箭头先**回看板**（否则用户以为它是"返回"，
        // 一点却把整个应用关掉了）；只有已经在看板时才真的退出。
        closeBtn.onclick = function () {
          if (App.view !== 'lobby') { App.backToLobby(); return; }
          App.teardown();
          if (typeof closeApp === 'function') closeApp('heartgame');
        };
      }

      // 全屏沉浸（v1.5.36）：心动游戏自己每一页都有返回/退出，顶部再留一条
      // 「心动游戏 · v4.44」的页头就是纯占地方。这里把它隐藏，让内容铺满整个
      // 应用窗口（.win-body 是 flex:1，页头一没就自然撑满）—— 和静室页面的观感一致。
      App.setImmersive(true);
      var body = document.getElementById('heartgame-body');
      if (!body) return;

      if (!HG) {
        body.innerHTML = '<div style="padding:28px; font-size:12px; color:#8b93a7; line-height:1.8;">'
          + '心动游戏内核未加载。请确认 index.html 已按顺序引入 '
          + 'app_heartgame_core.js / app_heartgame_portraits.js / app_heartgame_gacha.js / '
          + 'app_heartgame_story.js / app_heartgame_quiet.js / app_heartgame_panels.js。</div>';
        return;
      }

      App.bindLifecycle();
      App.bindActions();

      // 每次从桌面进来都回到主界面看板（上次可能停在任务/商店页）
      App.view = 'lobby';
      App.viewArg = null;

      // 载入状态
      body.innerHTML = '';
      body.appendChild(HG.H.loading('正在校准心动频率…'));

      var sessionId = null;
      try {
        if (typeof activeSessionId !== 'undefined' && activeSessionId) sessionId = Number(activeSessionId);
      } catch (e) { }

      var meId = HG.K.resolveMeId();
      var charId = await HG.K.resolveCharIdAsync(sessionId);
      await HG.K.bind({ charId: charId, meId: meId, sessionId: sessionId });

      // 兜底：IndexedDB 不可用 / 档案库为空时 charId 可能是 null，
      // 但主界面（立绘、热区、任务、商店、静室）在「无角色」状态下也必须可用，
      // 所以这里绝不允许 state 为 null —— 否则后续任何 K.state.x 都会炸。
      if (!HG.K.state) {
        HG.K.state = HG.K.blank(charId || 0, meId || 0);
        HG.K._sessionRow = HG.K._stateKey(charId || 0, meId || 0);
      }

      HG.K.rollQuests();
      HG.K.state.stats.sessions = HG.U.int(HG.K.state.stats.sessions, 0) + 1;
      if (!HG.K.state.bond.firstMeetAt) {
        HG.K.state.bond.firstMeetAt = Date.now();
        HG.K.pushTimeline({ type: 'meet', title: '初遇', text: '你第一次打开了心动游戏，屏幕里的人抬起头看了你一眼。' });
      }
      HG.K.save();

      App.initialized = true;
      await App.render();
      await App.probeSkin();
      App.startOnlineTracking();
    },

    /**
     * 诊断浮条（v1.5.33）：
     * 之前所有排查都卡在「我这边测不出来、你那边一直不对」。
     * 这条浮标把**真实环境数据**直接画在屏幕上（视口/容器/立绘的真实矩形 + 每次点击结果），
     * 截图一张就能定位，不用再来回猜。
     * 点它可收起；顶部仍保留一个极小的「诊断」角标可再展开。
     */
    DIAG_KEY: 'hg-diag',

    diagEnabled: function () {
      try {
        var v = localStorage.getItem(App.DIAG_KEY);
        // v1.5.35：排查用的诊断条**默认关闭**了（「点入口没反应」的根因已修复并验证）。
        // 需要时在控制台执行 heartGameApp.setDiag(true) 即可重新打开。
        return v === '1';
      } catch (e) { return false; }
    },

    setDiag: function (on) {
      try { localStorage.setItem(App.DIAG_KEY, on ? '1' : '0'); } catch (e) { }
      App.renderDiag();
    },

    /** 记录一次动作执行结果（供诊断浮条显示） */
    logAction: function (name, ok, detail) {
      App._actLog = App._actLog || [];
      App._actLog.unshift({ name: name, ok: ok !== false, detail: detail || '', at: Date.now() });
      if (App._actLog.length > 6) App._actLog.pop();
      App.renderDiag();
    },

    /** 绘制/刷新诊断浮条 */
    renderDiag: function () {
      var H = HG.H;
      var old = document.getElementById('hg-diag-bar');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var oldBtn = document.getElementById('hg-diag-btn');
      if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);
      var host = document.getElementById('heartgame-body');
      if (!host || !App.diagEnabled()) return;

      var r = function (el) {
        if (!el) return 'null';
        var b = el.getBoundingClientRect();
        return [b.left, b.top, b.right, b.bottom].map(function (v) { return Math.round(v); }).join(',');
      };
      var ph = document.getElementById('phone-container');
      var hgWin = document.getElementById('win-heartgame');
      var mount = document.getElementById('heartgame-mount');
      var pAnn = document.getElementById('hg-portrait-host');
      var pImg = pAnn ? pAnn.querySelector('img') : null;
      var nat = pImg && pImg.naturalWidth ? (pImg.naturalWidth + 'x' + pImg.naturalHeight) : '未加载';

      var lines = [];
      lines.push('版本 ' + (typeof CHANGELOG_DATA !== 'undefined' && CHANGELOG_DATA[0] ? CHANGELOG_DATA[0].version : '?')
        + '  · 视口 ' + window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1));
      lines.push('手机容器 ' + r(ph));
      lines.push('应用窗口 ' + r(hgWin) + ' ' + (hgWin ? (hgWin.classList.contains('active') ? 'active' : 'inactive') : ''));
      lines.push('看板 ' + r(mount));
      lines.push('立绘舞台 ' + r(pAnn));
      lines.push('立绘图 ' + r(pImg) + ' 原始 ' + nat);
      if (pImg) {
        var cs = getComputedStyle(pImg);
        lines.push('立绘样式 fit=' + cs.objectFit + ' pos=' + cs.objectPosition + ' tr=' + cs.transform);
      }
      lines.push('--- 最近点击 ---');
      (App._actLog || []).slice(0, 5).forEach(function (a) {
        // 不用对勾/叉号符号：项目红线禁止任何 emoji 区间字符（全量自检会拦）
        lines.push((a.ok ? '[成功] ' : '[失败] ') + a.name + (a.detail ? ' · ' + a.detail : ''));
      });
      if (!(App._actLog || []).length) lines.push('（还没有点击记录）');

      var bar = H.el('div', { id: 'hg-diag-bar' });
      // pointer-events:none —— 诊断浮条绝不能挡住底部工具栏与抽卡按钮
      // （之前它是可点的，会吃掉落在它上面的点击）
      bar.style.cssText = 'position:absolute; left:6px; right:6px; bottom:6px; z-index:40;'
        + 'max-height:46%; overflow:hidden; box-sizing:border-box; pointer-events:none;'
        + 'background:rgba(20,14,26,0.84); color:#EBD9F0; border:1px solid rgba(217,127,168,0.5);'
        + 'border-radius:12px; padding:8px 10px; font-size:9.5px; line-height:1.62;'
        + 'font-family:ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; word-break:break-all;';
      bar.textContent = lines.join('\n');
      host.appendChild(bar);

      // 收起按钮：唯一可点的一小块，放在浮条右上角
      var hide = H.el('div', { id: 'hg-diag-hide' });
      hide.style.cssText = 'position:absolute; right:10px; bottom:calc(46% + 2px); z-index:41;'
        + 'padding:2px 8px; border-radius:99px; cursor:pointer;'
        + 'background:rgba(20,14,26,0.86); color:#EBD9F0; font-size:9px;'
        + 'border:1px solid rgba(217,127,168,0.5);';
      hide.textContent = '收起诊断';
      hide.onclick = function (e) { e.stopPropagation(); App.setDiag(false); };
      host.appendChild(hide);
    },
    probeSkin: async function () {
      if (!HG.Skin || !HG.SKIN_MANIFEST) return;
      if (App._skinApplied) return;                 // 防重入：绝不重复重绘（重复重绘会叠加闪烁）
      try {
        var found = await HG.Skin.probeAll(HG.SKIN_MANIFEST);
        var n = Object.keys(found).reduce(function (a, g) { return a + Object.keys(found[g]).length; }, 0);
        if (n > 0 && !App._skinApplied) {
          App._skinApplied = true;
          await App.render();
        }
      } catch (e) {
        console.warn('[心动游戏] 皮肤素材探测失败（继续用内联 SVG / 纯 CSS）:', e);
      }
    },

    /** 关闭 */
    exit: function () {
      App.teardown();
      if (typeof closeApp === 'function') closeApp('heartgame');
    },

    /**
     * 全屏沉浸开关（v1.5.36）
     * 隐藏应用自带的标题栏，让内容铺满整扇窗口。样式只注入一次。
     */
    setImmersive: function (on) {
      var win = document.getElementById('win-heartgame');
      if (!win) return;
      if (!document.getElementById('hg-immersive-style')) {
        var s = document.createElement('style');
        s.id = 'hg-immersive-style';
        s.textContent = '#win-heartgame.hg-immersive .win-header{display:none !important;}'
          + '#win-heartgame.hg-immersive .win-body{height:100% !important;}';
        (document.head || document.documentElement).appendChild(s);
      }
      if (on) win.classList.add('hg-immersive');
      else win.classList.remove('hg-immersive');
    },

    // ------------------------------------------------------------------
    //  1.1b 动作委托：主页所有可点元素统一由 document 捕获阶段派发
    // ------------------------------------------------------------------

    /**
     * 为什么不再逐个 `el.onclick = fn`：
     *   主页入口的点击反复出现「点了没反应」，而我在探针里每次都测通过 ——
     *   说明失败点在「我的探针复现不了的真实环境差异」上（透明层、stopPropagation、
     *   重绘换节点、触摸事件顺序……）。逐个挂 onclick 的失败面太大且完全静默。
     *
     * 现在改为：元素只带 `data-hg-action="动作名"`，由 document 的**捕获阶段**统一派发：
     *   · 捕获先于冒泡，任何人的 stopPropagation 都拦不住；
     *   · 用 closest() 取动作，点在内部 SVG 上同样命中；
     *   · 命中即 stopPropagation + preventDefault，不会误触桌面手势；
     *   · 派发包 try/catch，出错直接 toast —— 永不再静默失败。
     * 只绑定一次，重绘换节点也不受影响。
     */
    ACTIONS: null,

    bindActions: function () {
      if (App._actionsBound) return;
      App._actionsBound = true;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var node = t.closest('[data-hg-action]');
        if (!node) return;
        var name = node.getAttribute('data-hg-action');
        var fn = App.ACTIONS && App.ACTIONS[name];
        if (typeof fn !== 'function') { App.logAction(name, false, '未注册的动作'); return; }
        e.stopPropagation();
        e.preventDefault();
        try {
          fn(node, e);
          App.logAction(name, true, '');
        } catch (err) {
          App.logAction(name, false, (err && err.message) ? err.message : String(err));
          console.error('[心动游戏] 动作执行失败: ' + name, err);
          try { HG.H.toast('操作失败：' + (err && err.message ? err.message : err)); } catch (e2) { }
        }
      }, true);
    },

    /** 给元素打动作标记 */
    act: function (el, name) {
      if (el && el.setAttribute) el.setAttribute('data-hg-action', name);
      return el;
    },

    /**
     * 生命周期接缝：
     * 项目里 closeApp 只做一次 classList.remove('active')（无 teardown 钩子），
     * 所以这里用两重保险来确保 Live2D 实例 / 资源池 / 定时器一定被释放。
     */
    bindLifecycle: function () {
      if (App.bound) return;
      App.bound = true;

      // ① 包一层 closeApp
      try {
        if (typeof window.closeApp === 'function' && !window.__hgCloseWrapped) {
          window.__hgCloseWrapped = true;
          var origClose = window.closeApp;
          window.closeApp = function (app) {
            if (app === 'heartgame') App.teardown();
            return origClose.apply(this, arguments);
          };
        }
      } catch (e) { }

      // ② 兜底：win-heartgame 失去 .active 时也清理（覆盖 Router.back 等旁路）
      try {
        var win = document.getElementById('win-heartgame');
        if (win && typeof MutationObserver === 'function' && !win.__hgObserved) {
          win.__hgObserved = true;
          var wasActive = win.classList.contains('active');
          var mo = new MutationObserver(function () {
            var nowActive = win.classList.contains('active');
            if (wasActive && !nowActive) App.teardown();
            wasActive = nowActive;
          });
          mo.observe(win, { attributes: true, attributeFilter: ['class'] });
          App._mo = mo;
        }
      } catch (e) { }

      // ③ 页面卸载（进程被杀 / 刷新）
      try {
        window.addEventListener('pagehide', function () { App.teardown(); });
      } catch (e) { }
    },

    /** 释放一切副作用：Live2D 实例、资源池、定时器、K 的事件订阅、浮层 */
    teardown: function () {
      App.stopOnlineTracking();
      App.view = 'lobby';
      App.viewArg = null;
      App.setImmersive(false);   // 把标题栏还给别的应用
      if (HG && HG.Portraits) { try { HG.Portraits.teardown(); } catch (e) { } }
      if (HG && HG.H) { try { HG.H.closeAllLayers(); } catch (e) { } }
      if (HG && HG.U) { try { HG.U.clearTimers(); } catch (e) { } }
      if (HG && HG.Quiet && HG.Quiet.UI) { try { HG.Quiet.close(); } catch (e) { } }
      App._unsubs.forEach(function (fn) { try { fn(); } catch (e) { } });
      App._unsubs = [];
      App.mounted = false;
      App._dom = null;
    },

    /** 在线挂机时长统计（每 30 秒结算一次，写入任务进度） */
    startOnlineTracking: function () {
      App.stopOnlineTracking();
      App.onlineSeconds = 0;
      App.onlineTimer = setInterval(function () {
        App.onlineSeconds += 30;
        HG.K.state.stats.totalOnlineSec = HG.U.int(HG.K.state.stats.totalOnlineSec, 0) + 30;
        // 每累计 30 秒推进一次「在线相伴」进度
        HG.K.progressQuest('online', 30);
      }, 30000);
    },

    stopOnlineTracking: function () {
      if (App.onlineTimer) { clearInterval(App.onlineTimer); App.onlineTimer = null; }
    },

    // ------------------------------------------------------------------
    //  1.2 主渲染
    // ------------------------------------------------------------------

    render: async function () {
      // 主线演出期间**挂起重绘**（v1.5.40）：
      // 主线舞台与主页看板共用同一个 Portraits 单例，而 App.render() → mountPortrait()
      // 的第一件事就是 Portraits.teardown()。只要演出期间看板重绘一次，
      // 主线的立绘就被销毁了 —— 这就是"主线里立绘时不时消失"的真正原因。
      if (App._suspended) { App._resumeRequested = true; return; }
      // 串行化重绘（v1.5.33）：render 是异步的（要读档案、等立绘挂载），
      // 皮肤探测与点击可能**并发**触发两次重绘，两次 DOM 重建交错就会表现为「剧烈闪烁」。
      // 这里保证同一时刻只有一次重绘在跑；期间来的请求合并为「跑完后再来一次」。
      if (App._rendering) { App._renderQueued = true; return; }
      App._rendering = true;
      try {
        await App._renderOnce();
      } finally {
        App._rendering = false;
        if (App._renderQueued) {
          App._renderQueued = false;
          App.render();
        }
      }
    },

    /**
     * 演出期间挂起 / 恢复看板重绘（v1.5.40）
     * 挂起期间的 render 请求会被合并成"恢复时再来一次"。
     */
    setSuspended: function (on) {
      App._suspended = !!on;
      if (!on && App._resumeRequested) {
        App._resumeRequested = false;
        App.render();
      }
    },

    /**
     * 当前看板视图（v1.5.35）
     *   'lobby'                                  — 主界面看板（立绘 + 热区 + 入口）
     *   'tasks' / 'shop' / 'bond'                — 看板内的独立页面（不再是 body 级抽屉）
     * 为什么改成页面：抽屉是**覆盖式浮层**，连点两下会叠两层，而且层级一旦压不过应用窗口
     * 就整片看不见。页面是「点入口 = 换页」，两个问题一起消失。
     */
    view: 'lobby',
    /** 当前页面的参数（例如商店的分类、牵绊的页签） */
    viewArg: null,

    /** 切换看板视图并重绘（幂等：重复点同一个入口只是重绘同一页） */
    setView: function (v, arg) {
      var nv = v || 'lobby';
      var na = (arg === undefined) ? null : arg;
      // 点的是同一个入口、而且这一页已经在屏幕上 -> 什么都不做。
      // 否则每次点击都整页重建，表现就是用户说的「点一下就闪烁一下」。
      if (App.view === nv && App.viewArg === na
        && App._dom && App._dom.root && App._dom.root.parentNode) {
        return Promise.resolve();
      }
      // 换页先收掉 body 级浮层：否则抽屉会压在页面上
      // （例如从「抽卡」抽屉里点到右侧入口，页面换了但抽屉还在）
      if (HG && HG.H && HG.H.closeAllLayers) { try { HG.H.closeAllLayers(); } catch (e) { } }
      App.view = nv;
      App.viewArg = na;
      return App.render();
    },

    /** 返回主界面看板 */
    backToLobby: function () { return App.setView('lobby'); },

    /**
     * 渲染一个看板内独立页面（v1.5.35）
     * 直接画进 #heartgame-mount：顶部「返回 + 标题」、中部可滚动内容、底部动作条。
     * 页面不挂立绘、也**不开任何 body 级浮层** —— 所以「连点叠层」与「被应用窗口盖住」
     * 这两个老问题在页面里根本无从发生。
     */
    _renderPage: function (body) {
      var H = HG.H, K = HG.K, U = HG.U;
      var spec = HG.Panels.pages[App.view](App.viewArg) || {};
      body.innerHTML = '';
      var root = H.el('div', { id: 'heartgame-mount', class: 'hg-page' + (App._painted ? '' : ' hg-rise') });
      App._painted = true;
      var pageBg = App.PAGE_BG[App.view] || '';
      root.style.cssText = 'position:relative; width:100%; height:100%; min-height:560px;'
        + 'display:flex; flex-direction:column; box-sizing:border-box; overflow:hidden;'
        + 'background:linear-gradient(170deg,#FFF7FB 0%,#FBF4FA 52%,#F4F2FB 100%);';
      // 有氛围底图时：**只加很淡的一层**，让插画真的看得见（用户反馈"太浅了压根看不见"）；
      // 可读性交给下面的毛玻璃卡片与状态栏，而不是靠把整张图糊白。
      if (pageBg) {
        root.style.backgroundImage = 'linear-gradient(180deg, rgba(255,250,252,0.16) 0%,'
          + ' rgba(255,247,251,0.30) 42%, rgba(248,246,255,0.52) 100%), ' + pageBg;
        root.style.backgroundSize = 'cover';
        root.style.backgroundPosition = 'center top';
      }
      App._dom = { root: root };

      // ---------- 顶栏：返回 + 标题 ----------
      var top = H.el('div');
      top.style.cssText = 'position:relative; z-index:10; flex-shrink:0; display:flex; align-items:center; gap:9px;'
        + 'padding:10px 13px 9px; border-bottom:1px solid rgba(216,160,190,0.22);'
        // 顶栏做成毛玻璃：浮在插画上，但底下的画仍然透得出来
        + 'background:linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,247,251,0.58));'
        + 'backdrop-filter:blur(16px) saturate(1.2); -webkit-backdrop-filter:blur(16px) saturate(1.2);';
      // 返回按钮做成带文字的胶囊：应用窗口顶部已经有一颗裸箭头（那是"退出应用"），
      // 这里再放一颗裸箭头会让人分不清哪颗是哪颗。
      var back = H.el('div');
      back.style.cssText = 'display:inline-flex; align-items:center; gap:3px; padding:6px 11px 6px 8px;'
        + 'border-radius:12px; cursor:pointer; flex-shrink:0;'
        + 'background:rgba(255,255,255,0.80); border:1px solid rgba(216,160,190,0.34); color:#8f6a80;'
        + 'font-size:11px; font-weight:800;';
      back.innerHTML = '<span style="display:flex; width:14px; height:14px;">'
        + H.icon('back', 14, { strokeWidth: 2.4 }) + '</span><span>返回</span>';
      App.act(back, 'page-back');
      top.appendChild(back);

      var ic = H.el('span');
      ic.style.cssText = 'width:30px; height:30px; border-radius:10px; display:flex; align-items:center;'
        + 'justify-content:center; flex-shrink:0; background:#FFEBF3; color:#D97FA8;';
      ic.innerHTML = H.icon(spec.icon || 'heart', 16, { strokeWidth: 1.9 });
      top.appendChild(ic);

      var tt = H.el('div');
      tt.style.cssText = 'flex:1; min-width:0;';
      tt.innerHTML = '<div style="font-size:14.5px; font-weight:800; color:#553f4c; letter-spacing:.02em;">'
        + U.esc(spec.title || '') + '</div>'
        + (spec.subtitle ? '<div style="font-size:10.5px; color:#a99fae; margin-top:2px;">'
          + U.esc(spec.subtitle) + '</div>' : '');
      top.appendChild(tt);
      root.appendChild(top);

      // ---------- 内容区（可滚动） ----------
      var content = H.el('div');
      content.style.cssText = 'position:relative; z-index:2; flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;'
        + 'padding:14px 16px 18px; overscroll-behavior:contain;';
      if (spec.content) content.appendChild(spec.content);
      root.appendChild(content);

      // ---------- 底部动作条（与抽屉的按钮条同形） ----------
      var buttons = spec.buttons || [];
      if (buttons.length) {
        var bar = H.el('div');
        bar.style.cssText = 'position:relative; z-index:10; flex-shrink:0; display:flex; gap:9px;'
          + 'padding:11px 16px calc(10px + env(safe-area-inset-bottom, 0px));'
          + 'border-top:1px solid rgba(216,160,190,0.18);'
          + 'background:rgba(255,255,255,0.62);'
          + 'backdrop-filter:blur(16px) saturate(1.2); -webkit-backdrop-filter:blur(16px) saturate(1.2);';
        buttons.forEach(function (cfg) {
          var b = H.button(cfg.text, {
            kind: cfg.kind || 'primary', block: true, icon: cfg.icon,
            color: cfg.color, color2: cfg.color2, soft: cfg.soft, glow: cfg.glow
          });
          b.onclick = function () {
            if (typeof cfg.onClick === 'function') {
              if (cfg.onClick(null) === false) return;   // 校验失败：保持当前页
            }
            // keepOpen 的按钮自己负责后续重绘（例如「让 TA 派一个委托」完成后自己重开面板）
            if (cfg.keepOpen !== true) App.render();
          };
          bar.appendChild(b);
        });
        root.appendChild(bar);
      }

      body.appendChild(root);
      App.renderDiag();
    },

    _renderOnce: async function () {
      var body = document.getElementById('heartgame-body');
      if (!body) return;
      var H = HG.H, K = HG.K, U = HG.U, C = HG.C;
      // 防御：state 未绑定完成时直接跳过（boot 是异步的，期间可能有并发重绘请求）
      if (!K.state) return;

      // ---------- 视图路由：独立页面分支 ----------
      // 页面只需要 state，不需要读档案（省掉两次带超时的档案读取）
      if (App.view !== 'lobby' && HG.Panels && HG.Panels.pages && HG.Panels.pages[App.view]) {
        App._renderPage(body);
        return;
      }
      App.view = 'lobby';

      // 档案读取一律带超时兜底：任何一次底层存储挂起都不允许把整个看板卡死
      var profile = await HG.K.readGuarded(function () { return K.charProfile(); }, 6000,
        { id: K.charId, name: 'TA', avatar: '', persona: '', remark: '', raw: null });
      var user = await HG.K.readGuarded(function () { return K.userProfile(); }, 6000,
        { id: K.meId, name: '你', avatar: '', persona: '', tags: [], reactPref: '', raw: null });
      var st = K.state;

      body.innerHTML = '';
      // 入场动画只在**首次**绘制时放（v1.5.40）：每次重绘都放一遍，
      // 观感就是"点一下就闪一下"。
      var root = H.el('div', { id: 'heartgame-mount', class: 'hg-lobby' + (App._painted ? '' : ' hg-rise') });
      App._painted = true;
      // 高度写成「100% 撑满 + 不低于 560px」：只看板容器本身撑不住，
      // 祖先链任何一环没有确定高度时 100% 会塌成 0，用户看到的就只是「打开了但一片空白」。
      root.style.cssText = 'position:relative; width:100%; height:100%; min-height:560px;'
        + 'display:flex; flex-direction:column; box-sizing:border-box; overflow:hidden;'
        + 'background:linear-gradient(170deg,#FFF7FB 0%,#FBF4FA 52%,#F4F2FB 100%);';
      App._dom = { root: root };

      // ---------- 舞台（立绘 + 热区） ----------
      var stage = H.el('div', { class: 'hg-lobby-stage' });
      stage.style.cssText = 'position:absolute; inset:0; overflow:hidden;';
      // 背景层（v1.5.35 重做）
      // 以前这里把「内置场景」整个排除掉了，于是背景抽屉里**选内置场景 → 主页不铺图**，
      // 用户看到的就是「背景点击后应用不上去」。现在只要用户**显式选过**背景就铺，
      // 内置场景同样算数 —— 立绘是抠过图的透明底，场景放后面不会互相打架。
      // 没选过（currentBackgroundId 为空）时仍然用原来的流光渐变底，保持默认观感不变。
      var bgLayer = H.el('div', { id: 'hg-lobby-bg' });
      bgLayer.style.cssText = 'position:absolute; inset:0; transition:opacity .5s ease;'
        + 'background-size:cover; background-position:center;';
      var bgId = (K.state.assets && K.state.assets.currentBackgroundId) || null;
      var userBg = bgId ? K.currentBackground() : null;
      var hasScene = !!(userBg && userBg.src);
      // 背景自己调过的位置与缩放（v1.5.38）
      var bgFit = K.backgroundFit(bgId);
      bgLayer.style.transformOrigin = '50% 50%';
      bgLayer.style.transform = 'translate(' + (bgFit.x * 100) + '%,' + (bgFit.y * 100) + '%) scale(' + bgFit.scale + ')';
      if (hasScene) {
        bgLayer.style.backgroundImage = 'url(' + userBg.src + ')';
        bgLayer.style.opacity = '.92';
      } else {
        // 没选场景时用**主页氛围底**（v1.5.43）：比原来的纯渐变好看得多，
        // 而且立绘依然是画面主角（上面还有一层压暗蒙版）
        bgLayer.style.backgroundImage = App.PAGE_BG.lobby;
        bgLayer.style.opacity = '1';
      }
      stage.appendChild(bgLayer);
      // 氛围光 / 压暗蒙版：铺了场景图时补一层很淡的暗角，
      // 保证立绘依然是画面里唯一的视觉中心（蒙版在立绘**下面**，不会把人物压灰）。
      var aura = H.el('div');
      aura.style.cssText = 'position:absolute; inset:0; pointer-events:none;'
        + 'background:radial-gradient(circle at 50% 30%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 56%),'
        + (hasScene
          ? 'linear-gradient(180deg, rgba(255,247,251,0.34) 0%, rgba(255,247,251,0.06) 26%,'
            + ' rgba(255,247,251,0.42) 74%, rgba(250,246,252,0.90) 100%),'
            + 'linear-gradient(180deg, rgba(255,247,251,0.10), rgba(60,40,70,0.22));'
          : 'linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 22%, rgba(255,247,251,0.92) 100%);');
      stage.appendChild(aura);
      // 立绘挂载点
      // v1.5.44：以前是 bottom:104px —— 而抽卡按钮在 bottom:62px 且高 88px，
      // 它的水平中线正好落在 106px 处，于是立绘**永远下不到那条线以下**，
      // 在调整视图里继续往下拖也会被吞掉（用户截图反馈）。
      // 现在直接铺到画面底部，底部工具栏与抽卡按钮靠 z-index 与渐变浮在上面。
      var portraitHost = H.el('div', { id: 'hg-portrait-host' });
      portraitHost.style.cssText = 'position:absolute; left:0; right:0; top:6%; bottom:0;';
      stage.appendChild(portraitHost);
      root.appendChild(stage);
      App._dom.bgLayer = bgLayer;
      App._dom.portraitHost = portraitHost;

      // 气泡（戳戳反馈）
      // 位置从 16%（压在脸上）挪到 56%：立绘是 2:3 竖构图，中下部才是"说话的位置"。
      var bubbleHost = H.el('div', { id: 'hg-touch-bubble' });
      // v1.5.48：入口已经改成无底板的悬浮图标，不再遮住文字，所以宽度还原成以前的 88%
      bubbleHost.style.cssText = 'position:absolute; left:16px; right:16px; top:56%; z-index:8;'
        + 'display:flex; justify-content:center; pointer-events:none; opacity:0; transition:opacity .3s ease;';
      root.appendChild(bubbleHost);
      App._dom.bubbleHost = bubbleHost;

      var title = document.querySelector('#win-heartgame .win-header h3');
      if (title) {
        var appV = appVersionLabel();
        title.textContent = '心动游戏' + (appV ? ' · ' + appV : '');
      }

      // 顶部栏
      var topbar = H.el('div', { class: 'hg-lobby-top' });
      topbar.style.cssText = 'position:relative; z-index:10; display:flex; align-items:flex-start;'
        + 'justify-content:space-between; gap:10px; padding:12px 13px 0; pointer-events:none;';
      root.appendChild(topbar);

      // 左上：角色切换 + 好感面板
      var leftCol = H.el('div');
      leftCol.style.cssText = 'pointer-events:auto; display:flex; flex-direction:column; gap:8px; max-width:74%;';
      var charRow = H.el('div');
      charRow.style.cssText = 'display:flex; align-items:center; gap:9px; padding:7px 12px 7px 7px; border-radius:999px;'
        + 'background:rgba(255,255,255,0.72); border:1px solid rgba(216,160,190,0.30);'
        + 'backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); cursor:pointer;'
        + 'box-shadow:0 6px 20px rgba(150,120,150,0.12); transition:transform .18s ease;';
      charRow.appendChild(H.avatar(profile.avatar, profile.name, 34));
      var nameBox = H.el('div');
      nameBox.style.cssText = 'min-width:0;';
      nameBox.innerHTML = '<div style="font-size:12.6px; font-weight:800; color:#553f4c; white-space:nowrap;'
        + 'overflow:hidden; text-overflow:ellipsis; max-width:104px;">' + U.esc(profile.name) + '</div>'
        + '<div style="font-size:9.4px; color:#a99fae; margin-top:1px;">' + U.esc(C.MODE_LABEL[st.mode]) + '</div>';
      charRow.appendChild(nameBox);
      var swIcon = H.el('span');
      swIcon.style.cssText = 'color:#c3b6c6; display:flex;';
      swIcon.innerHTML = H.icon('down', 14, { strokeWidth: 2.4 });
      charRow.appendChild(swIcon);
      charRow.onpointerdown = function () { charRow.style.transform = 'scale(0.97)'; };
      charRow.onpointerup = function () { charRow.style.transform = ''; };
      charRow.onpointerleave = function () { charRow.style.transform = ''; };
      App.act(charRow, 'char-switch');
      leftCol.appendChild(charRow);

      // 好感度面板（下拉）
      var affWrap = H.el('div');
      affWrap.style.cssText = 'pointer-events:auto;';
      leftCol.appendChild(affWrap);
      App._dom.affWrap = affWrap;
      topbar.appendChild(leftCol);

      // 右上：透明浮动「切换背景」
      var rightCol = H.el('div');
      rightCol.style.cssText = 'pointer-events:auto; display:flex; flex-direction:column; gap:8px; align-items:flex-end;';
      var bgBtn = H.iconButton('bg', {
        size: 38, color: '#8f6a80', bg: 'rgba(255,255,255,0.60)',
        border: 'rgba(216,160,190,0.32)', title: '切换背景'
      });
      bgBtn.style.backdropFilter = 'blur(12px)';
      App.act(bgBtn, 'bg-picker');
      rightCol.appendChild(bgBtn);
      topbar.appendChild(rightCol);

      // ---------- 右侧中下：竖向玻璃拟态图标组 ----------
      var rail = H.el('div', { class: 'hg-lobby-rail' });
      rail.style.cssText = 'position:absolute; right:12px; top:50%; transform:translateY(-46%); z-index:9;'
        + 'display:flex; flex-direction:column; gap:10px;';
      var RAIL = [
        { key: 'task', label: '每日任务', icon: 'task', color: '#7E97C9', soft: '#EDF2FB', open: function () { HG.Panels.openTasks(); } },
        { key: 'shop', label: '商店', icon: 'shop', color: '#D97FA8', soft: '#FFEBF3', open: function () { HG.Panels.openShop(); } },
        { key: 'bond', label: '牵绊', icon: 'bond', color: '#B79EDC', soft: '#F3EEFF', open: function () { HG.Panels.openBond(); } },
        { key: 'story', label: '主线剧情', icon: 'book', color: '#8FB8DE', soft: '#EAF3FF', open: function () { HG.Story.open(); } }
      ];
      App._dom.rail = {};
      RAIL.forEach(function (item) {
        var btn = App.buildRailButton(item);
        rail.appendChild(btn);
        App._dom.rail[item.key] = btn;
      });
      root.appendChild(rail);

      // ---------- 右下角：抽卡（大尺寸动态悬浮光晕） ----------
      var gachaWrap = H.el('div', { class: 'hg-lobby-gacha' });
      // 抬到工具栏上方：工具栏贴底，抽卡按钮留出它的高度（44+12）
      gachaWrap.style.cssText = 'position:absolute; right:14px; bottom:62px; z-index:10;';
      var pool = HG.Gacha && HG.Gacha.Pools ? HG.Gacha.Pools.active() : null;
      var upCard = pool ? ((pool.cards || []).filter(function (c) { return c.up; })[0] || (pool.cards || [])[0]) : null;
      var gachaBtn = H.el('div');
      gachaBtn.style.cssText = 'position:relative; width:88px; height:88px; border-radius:50%; cursor:pointer;'
        + 'transition:transform .2s cubic-bezier(.22,1,.36,1);';
      // 抽卡入口优先用生成式「星盘法阵」徽记（已抠白）：
      // 深色法阵叠在浅色主页上对比强烈、仪式感足，正是用户要的那种入口。
      var entryArt = HG.Skin && HG.Skin.get('gacha', 'entry');
      if (entryArt) {
        var gface = H.el('div');
        gface.style.cssText = 'position:absolute; inset:0; border-radius:50%;'
          + 'background-image:url(' + entryArt + '); background-size:cover; background-position:center;'
          + 'filter:drop-shadow(0 8px 18px rgba(90,60,120,0.38));';
        gachaBtn.appendChild(gface);
      } else if (upCard && (upCard.thumb || upCard.image)) {
        var gim = H.el('img', { alt: '' });
        gim.src = upCard.thumb || upCard.image;
        gim.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:50%;';
        gachaBtn.appendChild(gim);
      } else if (HG.Skin && HG.Skin.has('gacha', 'banner')) {
        var gbanner = H.el('img', { alt: '' });
        gbanner.src = HG.Skin.get('gacha', 'banner');
        gbanner.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:50%;';
        gachaBtn.appendChild(gbanner);
      } else {
        gachaBtn.style.background = 'linear-gradient(150deg,#D97FA8,#B79EDC)';
        gachaBtn.style.boxShadow = '0 12px 32px rgba(217,127,168,0.42)';
      }
      var gshine = H.el('div');
      gshine.className = 'hg-shimmer';
      gshine.style.cssText = 'position:absolute; inset:0; border-radius:50%; pointer-events:none; opacity:.30;';
      gachaBtn.appendChild(gshine);
      var glabel = H.el('div');
      glabel.style.cssText = 'position:absolute; left:50%; bottom:-5px; transform:translateX(-50%);'
        + 'padding:3px 13px; border-radius:99px; white-space:nowrap;'
        + 'background:linear-gradient(135deg, rgba(58,38,78,0.94), rgba(92,62,122,0.94));'
        + 'border:1px solid rgba(206,176,124,0.6); box-shadow:0 5px 16px rgba(60,30,70,0.38);';
      glabel.innerHTML = '<span style="font-size:9.6px; font-weight:900; color:#F4E4C2; letter-spacing:.24em;">抽 卡</span>';
      gachaBtn.appendChild(glabel);
      var ghalo = H.el('div');
      ghalo.style.cssText = 'position:absolute; inset:-12px; border-radius:50%; pointer-events:none;'
        + 'background:radial-gradient(circle, rgba(183,158,220,0.45) 0%, transparent 70%);'
        + 'animation:hg-pulse 2.6s ease-in-out infinite; z-index:-1;';
      gachaBtn.appendChild(ghalo);
      gachaBtn.onpointerdown = function () { gachaBtn.style.transform = 'scale(0.94)'; };
      gachaBtn.onpointerup = function () { gachaBtn.style.transform = ''; };
      gachaBtn.onpointerleave = function () { gachaBtn.style.transform = ''; };
      App.act(gachaBtn, 'gacha');
      gachaWrap.appendChild(gachaBtn);
      root.appendChild(gachaWrap);

      // ---------- 底部右对齐工具栏 ----------
      var bottom = H.el('div', { class: 'hg-lobby-bottom' });
      // 贴到容器最底部：原来 bottom:0 + padding-bottom:12px，工具栏实际落在
      // 容器底边上方约 82px 处；而手机容器在各种机型上会被上移/压缩，
      // 结果工具栏正好卡在裁切边缘（探针里 4 个按钮全量不到命中）。
      // 现在把工具栏压到最底、并给一层安全区内边距，保证它在任何机型上都完整可见。
      bottom.style.cssText = 'position:absolute; left:0; right:0; bottom:0; z-index:11;'
        + 'padding:16px 12px calc(8px + env(safe-area-inset-bottom, 0px));'
        + 'display:flex; align-items:center; justify-content:flex-end; gap:7px;'
        + 'background:linear-gradient(0deg, rgba(255,247,251,0.98) 0%, rgba(255,247,251,0.80) 55%, rgba(255,247,251,0) 100%);';
      var TOOLS = [
        { key: 'exit', label: '退出', icon: 'exit', color: '#9a919f', soft: 'rgba(240,236,244,0.9)', open: function () { App.exit(); } },
        { key: 'admin', label: '后台管理', icon: 'admin', color: '#7E97C9', soft: '#EDF2FB', open: function () { HG.Portraits.openAdmin(function () { App.render(); }); } },
        { key: 'portrait', label: '立绘管理', icon: 'portrait', color: '#B79EDC', soft: '#F3EEFF', open: function () { HG.Portraits.openManager(function () { App.render(); }); } },
        { key: 'quiet', label: '静室', icon: 'quiet', color: '#D97FA8', soft: '#FFEBF3', open: function () { HG.Quiet.open(); } }
      ];
      TOOLS.forEach(function (t) {
        var b = H.el('button', { class: 'hg-tool-btn', type: 'button' });
        var art = App.ENTRY_BG[t.key];
        if (art) {
          // v1.5.46：底部四个入口同样**不要底板、不要外框**：
          // 透明底图标 + 一行描边小字，和右侧入口是一套视觉
          b.style.cssText = 'display:inline-flex; align-items:center; gap:4px; padding:4px 6px;'
            + 'border-radius:12px; font-size:11px; font-weight:800; cursor:pointer;'
            + 'transition:transform .16s ease; border:none; background:none; box-shadow:none;'
            + 'color:#4a3a5c;'
            + 'text-shadow:0 1px 3px rgba(255,255,255,0.98), 0 0 7px rgba(255,255,255,0.92);';
          b.innerHTML = '<img alt="" src="' + art + '" style="width:24px;height:24px;object-fit:contain;'
            + 'flex-shrink:0;pointer-events:none;'
            + 'filter:drop-shadow(0 1px 2px rgba(255,255,255,0.95));">'
            + '<span>' + t.label + '</span>';
        } else {
          // 没有底图时回落原来的浅色玻璃（纯 CSS，见 buildRailButton 的说明）
          b.style.cssText = 'display:inline-flex; align-items:center; gap:5px; padding:8px 12px; border-radius:13px;'
            + 'font-size:11px; font-weight:700; cursor:pointer;'
            + 'transition:transform .16s ease, box-shadow .2s ease;'
            + 'border:1px solid rgba(190,180,195,0.24); background:' + t.soft + '; color:' + t.color + ';'
            + 'backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);';
          b.innerHTML = H.icon(t.icon, 14, { strokeWidth: 2 }) + '<span>' + t.label + '</span>';
        }
        b.onpointerdown = function () { b.style.transform = 'scale(0.95)'; };
        b.onpointerup = function () { b.style.transform = ''; };
        b.onpointerleave = function () { b.style.transform = ''; };
        App.act(b, 'tool-' + t.key);
        bottom.appendChild(b);
      });
      root.appendChild(bottom);

      body.appendChild(root);

      // 好感面板 + 立绘挂载 + 事件订阅
      App.renderAffinityPanel();
      // 立绘挂载必须带超时：档案读取走的是带兜底的 _withTimeout，
      // 但若底层存储整体挂起，这里会把整个 render 卡在半路 ——
      // 那样底部工具栏与皮肤重绘都到不了，界面就永久停在旧一帧。
      await App.mountPortraitSafe();
      App.subscribe();
      App.renderDiag();
    },

    /** 挂载立绘，带 5 秒硬超时（超时就用剪影占位继续） */
    mountPortraitSafe: async function () {
      try {
        await Promise.race([
          App.mountPortrait(),
          new Promise(function (resolve) { setTimeout(resolve, 5000); })
        ]);
      } catch (e) {
        console.warn('[心动游戏] 立绘挂载失败（继续渲染其余部分）:', e);
      }
    },

    /** 右侧图标组按钮（纯 CSS 玻璃拟态 + 内联 SVG glyph）
     *  说明：这里刻意不用生成式素材做按钮底。玻璃元件本身是白的，
     *  生成图只能输出白底，抠白会把元件高光一起抠掉、不抠就留白边；
     *  而纯 CSS 在浅色底上无色差、无白边、不占体积，观感更干净。 */
    buildRailButton: function (item) {
      var H = HG.H;
      var art = App.ENTRY_BG[item.key];
      var btn = H.el('div', { class: 'hg-rail-btn' });
      if (art) {
        // v1.5.46：**不要底板、不要外框** —— 只有图标本身 + 一行小字，
        // 像一枚悬浮的坐标点。可读性靠图标自带的白描边与文字投影。
        btn.style.cssText = 'position:relative; width:52px; height:52px; cursor:pointer;'
          + 'background:none; border:none; box-shadow:none;'
          + 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;'
          + 'transition:transform .18s cubic-bezier(.22,1,.36,1);';
        var icImg = H.el('img', { alt: '', src: art });
        icImg.style.cssText = 'width:30px; height:30px; object-fit:contain; pointer-events:none;'
          + 'filter:drop-shadow(0 1px 3px rgba(255,255,255,0.95)) drop-shadow(0 0 6px rgba(255,255,255,0.85));';
        btn.appendChild(icImg);
      } else {
        btn.style.cssText = 'position:relative; width:52px; height:52px; border-radius:18px; cursor:pointer;'
          + 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;'
          + 'background:linear-gradient(150deg, rgba(255,255,255,0.86), rgba(255,255,255,0.62));'
          + 'border:1px solid ' + item.color + '33;'
          + 'backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);'
          + 'box-shadow:0 8px 22px rgba(150,120,150,0.14), inset 0 1px 0 rgba(255,255,255,0.9);'
          + 'transition:transform .18s cubic-bezier(.22,1,.36,1), box-shadow .22s ease;';
      }
      if (!art) {
        var ic = H.el('span');
        ic.style.cssText = 'color:' + item.color + '; display:flex;';
        ic.innerHTML = H.icon(item.icon, 19, { strokeWidth: 1.7 });
        btn.appendChild(ic);
      }
      var lb = H.el('span');
      if (art) {
        // 无底板之后，小字靠白描边保证在深色立绘上也读得清
        lb.style.cssText = 'font-size:8.4px; font-weight:800; line-height:1; letter-spacing:.02em;'
          + 'color:#4a3a5c; pointer-events:none;'
          + 'text-shadow:0 1px 3px rgba(255,255,255,0.98), 0 0 7px rgba(255,255,255,0.92);';
      } else {
        lb.style.cssText = 'font-size:8.2px; font-weight:800; color:#8b8292; letter-spacing:.01em; line-height:1;';
      }
      lb.textContent = item.label.length > 4 ? item.label.slice(0, 4) : item.label;
      btn.appendChild(lb);
      // 角标（待领取数量）
      if (item.key === 'task') {
        var ready = HG.K.chestReady().length + (HG.K.state.quests.dynamic || []).filter(function (q) { return q.done; }).length;
        var claimable = 0;
        HG.C.BASE_QUESTS.forEach(function (q) {
          var rec = HG.K.state.quests.base[q.key];
          if (rec && rec.done && !rec.claimed) claimable++;
        });
        var total = ready + claimable;
        if (total > 0) {
          var badge = H.el('span');
          badge.style.cssText = 'position:absolute; right:-3px; top:-3px; min-width:17px; height:17px; border-radius:9px;'
            + 'background:linear-gradient(135deg,#D97FA8,#B79EDC); color:#fff; font-size:9px; font-weight:900;'
            + 'display:flex; align-items:center; justify-content:center; padding:0 4px;'
            + 'box-shadow:0 3px 9px rgba(217,127,168,0.45);';
          badge.textContent = total;
          btn.appendChild(badge);
        }
      }
      btn.onpointerdown = function () { btn.style.transform = 'scale(0.93)'; };
      btn.onpointerup = function () { btn.style.transform = ''; };
      btn.onpointerleave = function () { btn.style.transform = ''; };
      App.act(btn, 'rail-' + item.key);
      return btn;
    },

    /**
     * 好感度面板：默认收起为「一行条」，点一下展开完整卡片。
     * 收起状态持久化在 localStorage（按 面具×角色 不区分，全局一个偏好即可）。
     */
    renderAffinityPanel: function () {
      var H = HG.H, K = HG.K, U = HG.U, C = HG.C;
      var wrap = App._dom && App._dom.affWrap;
      if (!wrap) return;
      var st = K.state;
      wrap.innerHTML = '';

      var LS_KEY = 'hg-affinity-collapsed';
      var collapsed = true;
      try {
        var saved = localStorage.getItem(LS_KEY);
        collapsed = (saved === null) ? true : (saved === '1');
      } catch (e) { }

      function setCollapsed(v) {
        collapsed = v;
        try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (e) { }
        App.renderAffinityPanel();
      }

      // ---- 收起态：一行薄条（等级 + 数值 + 迷你进度） ----
      if (collapsed) {
        var bar = H.el('div', { id: 'hg-affinity-panel', class: 'hg-aff-mini' });
        bar.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 10px 6px 7px; border-radius:999px;'
          + 'cursor:pointer; max-width:230px; box-sizing:border-box;'
          + 'background:linear-gradient(150deg, rgba(255,255,255,0.88), rgba(255,247,251,0.72));'
          + 'border:1px solid rgba(216,160,190,0.30); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);'
          + 'box-shadow:0 6px 18px rgba(150,120,150,0.12); transition:transform .16s ease;';
        var isRev = st.mode === C.MODE.REVERSE_STRATEGY;
        var tier = K.tier();
        var mood = K.moodOf(st.verdict.mood);
        var accent = isRev ? mood.color : tier.color;
        var ic = H.el('span');
        ic.style.cssText = 'width:20px; height:20px; border-radius:50%; flex-shrink:0; display:flex; align-items:center;'
          + 'justify-content:center; background:' + accent + '22; color:' + accent + ';';
        ic.innerHTML = H.icon(isRev ? mood.icon : 'heart', 12, { strokeWidth: 2.2 });
        bar.appendChild(ic);
        var txt = H.el('span');
        txt.style.cssText = 'font-size:10.6px; font-weight:800; color:#7d7484; white-space:nowrap;';
        txt.textContent = isRev
          ? (mood.name + ' ' + U.int(st.verdict.value, 0) + '%')
          : (tier.name + ' ' + U.comma(st.affinity));
        bar.appendChild(txt);
        var dash = H.el('span');
        dash.style.cssText = 'flex:1; min-width:24px; height:5px; border-radius:99px; overflow:hidden;'
          + 'background:rgba(216,190,210,0.28); position:relative;';
        var fill = H.el('span');
        fill.style.cssText = 'position:absolute; left:0; top:0; bottom:0; width:'
          + (isRev ? U.int(st.verdict.value, 0) : K.tierProgress()) + '%;'
          + 'background:linear-gradient(90deg,' + accent + ',#B79EDC);';
        dash.appendChild(fill);
        bar.appendChild(dash);
        var exp = H.el('span');
        exp.style.cssText = 'color:#b7adc0; display:flex; flex-shrink:0;';
        exp.innerHTML = H.icon('down', 13, { strokeWidth: 2.4 });
        bar.appendChild(exp);
        bar.onpointerdown = function () { bar.style.transform = 'scale(0.97)'; };
        bar.onpointerup = function () { bar.style.transform = ''; };
        bar.onpointerleave = function () { bar.style.transform = ''; };
        App.act(bar, 'aff-expand');
        wrap.appendChild(bar);
        return;
      }

      var card = H.el('div', { id: 'hg-affinity-panel' });
      card.style.cssText = 'border-radius:18px; padding:11px 12px; max-width:230px; box-sizing:border-box;'
        + 'position:relative;'
        + 'background:linear-gradient(150deg, rgba(255,255,255,0.88), rgba(255,247,251,0.74));'
        + 'border:1px solid rgba(216,160,190,0.30); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);'
        + 'box-shadow:0 10px 26px rgba(150,120,150,0.14);';
      wrap.appendChild(card);

      // 收起按钮（右上角小箭头）
      var fold = H.el('button', { type: 'button', title: '收起好感度面板' });
      fold.style.cssText = 'position:absolute; right:8px; top:8px; width:22px; height:22px; border-radius:50%;'
        + 'border:1px solid rgba(216,160,190,0.35); background:rgba(255,255,255,0.9); color:#b7adc0;'
        + 'display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; z-index:2;';
      fold.innerHTML = H.icon('up', 12, { strokeWidth: 2.4 });
      App.act(fold, 'aff-collapse');
      card.appendChild(fold);

      if (st.mode === C.MODE.REVERSE_STRATEGY) {
        // —— 被攻略模式：User 对 Char 的好感裁定器 ——
        var mood = K.moodOf(st.verdict.mood);
        var head = H.el('div');
        head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
        head.innerHTML = '<span style="font-size:9.6px; letter-spacing:.16em; color:#B79EDC; font-weight:900;">心意裁定</span>'
          + '<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:800; color:'
          + mood.color + ';">' + H.icon(mood.icon, 11, { strokeWidth: 2.2 }) + mood.name + '</span>';
        card.appendChild(head);

        var val = H.el('div');
        val.style.cssText = 'display:flex; align-items:baseline; gap:4px; margin:8px 0 6px;';
        val.innerHTML = '<span style="font-size:26px; font-weight:900; color:#D97FA8; line-height:1;">'
          + U.int(st.verdict.value, 0) + '</span>'
          + '<span style="font-size:11px; color:#a99fae;">/ 100</span>';
        card.appendChild(val);

        card.appendChild(H.progress({
          value: U.int(st.verdict.value, 0), height: 7, color: mood.color, color2: '#B79EDC'
        }));

        var quick = H.el('div');
        quick.style.cssText = 'display:flex; gap:5px; margin-top:9px;';
        [-5, -1, 1, 5].forEach(function (n) {
          var b = H.el('button', { type: 'button' });
          b.style.cssText = 'flex:1; padding:5px 0; border-radius:9px; font-size:10.4px; font-weight:800; cursor:pointer;'
            + 'border:none;'
            + (n > 0 ? 'background:#FFEBF3; color:#B0728F;' : 'background:#EDF2FB; color:#5f7aa8;');
          b.textContent = (n > 0 ? '+' : '') + n;
          b.setAttribute('data-delta', String(n));
          App.act(b, 'aff-quick');
          quick.appendChild(b);
        });
        card.appendChild(quick);

        var setMood = H.el('button', { type: 'button' });
        setMood.style.cssText = 'width:100%; margin-top:7px; padding:6px 0; border-radius:10px; font-size:10.4px;'
          + 'font-weight:800; cursor:pointer; border:1px dashed rgba(183,158,220,0.5); background:rgba(243,238,255,0.7);'
          + 'color:#7d63a8;';
        setMood.textContent = '设定心情指数';
        App.act(setMood, 'aff-mood');
        card.appendChild(setMood);
      } else {
        // —— 攻略模式：阶梯式好感进阶条 ——
        var tier = K.tier();
        var pct = K.tierProgress();
        var head2 = H.el('div');
        head2.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
        head2.innerHTML = '<span style="font-size:9.6px; letter-spacing:.16em; color:' + tier.color + '; font-weight:900;">'
          + '心动等级 · ' + tier.name + '</span>'
          + '<span style="font-size:9.4px; color:#a99fae;">' + (K.tierIndex() + 1) + '/6</span>';
        card.appendChild(head2);

        var val2 = H.el('div');
        val2.style.cssText = 'margin:8px 0 7px;';
        val2.innerHTML = '<span style="font-size:22px; font-weight:900; color:' + tier.color + '; line-height:1;">'
          + U.comma(st.affinity) + '</span>'
          + '<span style="font-size:9.6px; color:#a99fae; margin-left:5px;">/ ' + U.comma(tier.max) + '</span>';
        card.appendChild(val2);

        card.appendChild(H.progress({
          value: pct, height: 8, color: tier.color, color2: '#B79EDC', glow: tier.glow,
          nodes: [{ pct: 100 }]
        }));

        var tip2 = H.el('div');
        tip2.style.cssText = 'font-size:9.6px; color:#a99fae; margin-top:7px; line-height:1.6;';
        tip2.textContent = K.isGated()
          ? '经验槽已满 · 完成晋阶任务可推进'
          : (K.tierIndex() >= C.AFFINITY_TIERS.length - 1
            ? '已抵达终局契约'
            : '距「' + C.AFFINITY_TIERS[K.tierIndex() + 1].name + '」还需 ' + U.comma(K.toNextTier()));
        card.appendChild(tip2);

        var detail = H.el('button', { type: 'button' });
        detail.style.cssText = 'width:100%; margin-top:8px; padding:6px 0; border-radius:10px; font-size:10.4px;'
          + 'font-weight:800; cursor:pointer; border:1px dashed rgba(217,127,168,0.45); background:rgba(255,241,247,0.75);'
          + 'color:#B0728F;';
        detail.textContent = '展开牵绊面板';
        App.act(detail, 'aff-goto');
        card.appendChild(detail);
      }

      // 代币条
      var wallet = H.el('div');
      wallet.style.cssText = 'display:flex; gap:8px; margin-top:9px; padding-top:9px;'
        + 'border-top:1px solid rgba(216,160,190,0.18);';
      [['heart', U.comma(st.wallet.tokens), '#D97FA8'], ['cards', U.comma(st.wallet.draws), '#B79EDC']].forEach(function (w) {
        var cell = H.el('span');
        cell.style.cssText = 'display:inline-flex; align-items:center; gap:4px; font-size:10.2px; font-weight:800; color:'
          + w[2] + ';';
        cell.innerHTML = H.icon(w[0], 12, { strokeWidth: 2.2 }) + '<span>' + w[1] + '</span>';
        wallet.appendChild(cell);
      });
      card.appendChild(wallet);
    },

    /** 挂载立绘 + 热区触控 */
    mountPortrait: async function () {
      var H = HG.H, K = HG.K;
      var host = App._dom && App._dom.portraitHost;
      if (!host) return null;
      var res = await HG.Portraits.mount(host, {
        fit: 'contain',
        onTouch: function (key, ev, spot) { App.handleTouch(key, ev, spot); }
      });
      App.mounted = true;
      return res;
    },

    /**
     * 热区触控（戳戳交互）
     * 攻略模式：好感上升 + 专属反应；被攻略模式：TA 反过来向你讨要回应
     */
    handleTouch: async function (key, ev, spot) {
      var H = HG.H, K = HG.K, U = HG.U, C = HG.C, st = K.state;
      var profile = await K.charProfile();

      st.stats.touches = U.int(st.stats.touches, 0) + 1;
      K.progressQuest('touch', 1);

      // 好感：不同部位权重不同，同一天反复戳同一处收益衰减
      // （部位表见 core 的 C.HOTSPOTS；越"亲密/具体"的部位收益越高）
      var WEIGHT = {
        head: 3, hair: 3, face: 5, eye: 4, mouth: 6, neck: 6,
        shoulder: 3, chest: 7, heart: 8, waist: 6,
        arm: 4, forearm: 4, hand: 6, leg: 5
      };
      var todayKey = 'touch_' + U.dayKey() + '_' + key;
      st.stats.touchToday = st.stats.touchToday || {};
      var times = U.int(st.stats.touchToday[todayKey], 0);
      st.stats.touchToday[todayKey] = times + 1;
      var decay = times < 3 ? 1 : (times < 6 ? 0.5 : 0.2);
      var base = Math.max(1, Math.round((WEIGHT[key] || 4) * decay));

      var result = await HG.Portraits.react(key, { mood: st.quiet.mood });
      var res = K.addAffinity(base, { reason: '戳戳 · ' + (spot ? spot.name : key), silent: false });

      // 心情随动
      st.quiet.mood = K.deriveMood().key;
      K.save();

      // 命中动画
      if (HG.Portraits.renderer && HG.Portraits.renderer.react) {
        HG.Portraits.renderer.react(key, result.expression);
      }

      // 气泡演出
      App.showTouchBubble(result.text, profile);

      // 日志卡（静室流）
      K.pushQuietSystem('*你' + (spot ? spot.hint : '碰了碰 TA') + '，'
        + (res.applied > 0 ? '对方的心跳乱了一拍' : '对方没什么反应') + '*', 'touch');

      // 反客为主：被攻略模式下 TA 会顺势索要回应
      if (K.isReverse() && Math.random() < 0.4) {
        var extraPrompt = HG.Quiet.Prompt.buildSystem(profile, await K.userProfile(), st) + '\n\n'
          + '事件：' + (await K.userProfile()).name + ' 刚刚在看板上碰了你的「' + (spot ? spot.name : '身体') + '」。\n'
          + '要求：第一人称，20~50 字，把它当成一次「互动反馈」，'
          + '顺带汇报一句你为此做的事（例如又氪了一单）。不要旁白。';
        var api = await K.resolveApi();
        if (api && typeof window.fwCallLLM === 'function') {
          try {
            var out = await window.fwCallLLM(api, [{ role: 'system', content: extraPrompt }], { temperature: 0.95 });
            if (out) K.pushQuiet({ role: 'char', text: String(out).trim(), tone: 'touch' });
          } catch (e) { }
        }
      }

      App.renderAffinityPanel();
      if (res.tierUp) {
        var tier = K.tier();
        H.toast('心动等级提升：' + tier.name);
      }
      if (res.gated) H.toast('经验槽已满，去牵绊面板完成晋阶任务');
    },

    /**
     * 戳戳气泡（v1.5.35 重做）
     * 以前是一张带渐变底 + 边框 + 阴影的卡片，压在立绘脸上；用户要求「只有文字、位置偏下」。
     * 现在：无底、无边框、无阴影，只靠文字投影保证可读性；位置挪到立绘中下部。
     */
    showTouchBubble: function (text, profile) {
      var H = HG.H, U = HG.U;
      var host = App._dom && App._dom.bubbleHost;
      if (!host) return;
      host.innerHTML = '';
      var bubble = H.el('div');
      // v1.5.48：宽度还原 88%（入口已无底板，不会再遮住文字）
      bubble.style.cssText = 'position:relative; max-width:88%; text-align:center;'
        + 'background:none; border:none; box-shadow:none; backdrop-filter:none; -webkit-backdrop-filter:none;'
        + 'font-size:13.4px; line-height:1.86; font-weight:600; color:#4a4050;'
        // 可读性靠文字投影而不是底板：先在字外围铺一圈近白柔光（暗背景上不糊），
        // 再给一点极淡的深色投影压住浅色背景（浅背景上不飘）。
        + 'text-shadow:0 1px 6px rgba(255,255,255,0.98), 0 0 18px rgba(255,247,251,0.95),'
        + ' 0 2px 12px rgba(0,0,0,0.10);';
      var who = H.el('div');
      who.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:5px; margin-bottom:6px;'
        + 'font-size:10.4px; font-weight:800; color:#B0728F; letter-spacing:.06em;';
      who.innerHTML = '<span style="width:12px; height:12px; display:inline-flex;">'
        + H.icon('heart', 12, { strokeWidth: 2 }) + '</span>'
        + '<span>' + U.esc(profile.name) + '</span>';
      bubble.appendChild(who);
      var t = H.el('div');
      t.textContent = text || '';
      bubble.appendChild(t);
      host.appendChild(bubble);
      host.style.opacity = '1';
      if (App._bubbleTimer) clearTimeout(App._bubbleTimer);
      // 用户读一句 20~38 字的话需要时间，5.2 秒太赶
      App._bubbleTimer = setTimeout(function () {
        host.style.opacity = '0';
      }, 7600);
    },

    // ------------------------------------------------------------------
    //  1.3 子面板入口
    // ------------------------------------------------------------------

    /** 角色切换器 */
    openCharSwitcher: async function () {
      var H = HG.H, K = HG.K, U = HG.U;
      var body = H.el('div');
      var chars = await K.listCharacters();
      var personas = await K.listPersonas();

      if (!chars.length) {
        body.appendChild(H.empty('档案库里还没有角色。先去档案馆新建一个角色，再回来。', { icon: 'mask' }));
      }
      body.appendChild(H.sectionTitle('选择角色', { color: '#D97FA8' }));
      chars.forEach(function (c) {
        var on = Number(c.id) === Number(K.charId);
        var row = H.listRow({
          icon: on ? 'heart' : 'mask',
          color: on ? '#D97FA8' : '#9FB3D9',
          soft: on ? '#FFEBF3' : '#EDF2FB',
          title: c.name || '未命名角色',
          subtitle: U.cut(c.persona || c.remark || '（未填写人设）', 40),
          leftNode: null,
          rightNode: on ? H.chip('当前', { color: '#D97FA8', soft: '#FFEBF3' }) : H.iconButton('next', { size: 26, color: '#c3b6c6' })
        });
        // 用头像替换左侧图标
        var avatar = H.avatar(c.avatar, c.name, 34);
        row.insertBefore(avatar, row.firstChild);
        var ic = row.querySelector('span');
        row.onclick = async function () {
          if (on) { H.closeAllLayers(); return; }
          await K.bind({ charId: Number(c.id), meId: K.meId, sessionId: null });
          H.closeAllLayers();
          H.toast('已切换到 ' + (c.name || '角色'));
          App.render();
        };
        body.appendChild(row);
      });

      // User 面具
      body.appendChild(H.sectionTitle('你的面具（User 身份）', { color: '#7E97C9' }));
      personas.forEach(function (p) {
        var on = Number(p.id) === Number(K.meId);
        var row = H.listRow({
          icon: on ? 'check' : 'mask',
          color: on ? '#7E97C9' : '#9FB3D9',
          soft: on ? '#EDF2FB' : '#F6F4F8',
          title: p.name || '未命名面具',
          subtitle: U.cut(p.persona || '（未填写人设）', 40),
          rightNode: on ? H.chip('使用中', { color: '#5f7aa8', soft: '#EDF2FB' }) : H.iconButton('next', { size: 26, color: '#c3b6c6' })
        });
        row.onclick = async function () {
          if (on) { H.closeAllLayers(); return; }
          try { localStorage.setItem('active_me_id', p.id); } catch (e) { }
          await K.bind({ charId: K.charId, meId: Number(p.id), sessionId: null });
          H.closeAllLayers();
          H.toast('已切换面具：' + (p.name || ''));
          App.render();
        };
        body.appendChild(row);
      });

      if (!personas.length) {
        body.appendChild(H.empty('还没有 User 面具。去档案馆的「我的」新建一个。', { icon: 'mask' }));
      }

      H.sheet({
        title: '角色与面具',
        subtitle: '心动游戏的数据按 角色 × 面具 双键隔离',
        icon: 'mask',
        height: '88%',
        slot: 'char-switcher',
        content: body
      });
    },

    /** 心情指数选择（反向模式） */
    openMoodPicker: function () {
      var H = HG.H, K = HG.K, C = HG.C;
      var body = H.el('div');
      var note = H.el('div');
      note.style.cssText = 'font-size:10.8px; line-height:1.72; color:#8b8292; background:rgba(255,241,247,0.8);'
        + 'border:1px solid rgba(217,127,168,0.22); border-radius:13px; padding:11px 12px; margin-bottom:12px;';
      note.textContent = '设定 TA 此刻的心境。TA 的静室回应、抽卡反应与任务汇报都会围绕这个心境展开。';
      body.appendChild(note);

      C.MOODS.forEach(function (m) {
        var on = K.state.verdict.mood === m.key;
        var row = H.listRow({
          icon: m.icon, color: m.color, soft: m.soft,
          title: m.name,
          subtitle: m.key === 'ecstatic' ? '好感 90+ 时的常态' :
            m.key === 'happy' ? '好感 72+ 时的常态' :
              m.key === 'calm' ? '好感 48+ 时的常态' :
                m.key === 'anxious' ? '好感偏低时的常态' :
                  m.key === 'jealous' ? '同类刺激下的应激反应' : '极致独占欲',
          rightNode: on ? H.chip('当前', { color: m.color, soft: m.soft }) : H.iconButton('next', { size: 26, color: '#c3b6c6' })
        });
        row.onclick = function () {
          K.setVerdict(K.state.verdict.value, { mood: m.key, note: K.state.verdict.note });
          H.closeAllLayers();
          H.toast('心情已设为「' + m.name + '」');
          App.renderAffinityPanel();
        };
        body.appendChild(row);
      });

      H.sheet({
        title: '心情指数', subtitle: '你为 TA 设定的心境', icon: 'smile', height: '76%',
        slot: 'mood-picker', content: body
      });
    },

    /** 平铺式背景切换抽屉 */
    openBackgroundDrawer: function () {
      var H = HG.H, K = HG.K, U = HG.U;
      var body = H.el('div');
      var list = K.state.assets.backgrounds || [];

      if (!list.length) {
        body.appendChild(H.empty('还没有自定义背景。上传一张图，它会同时供主页看板与 VN 剧情引擎调用。', { icon: 'bg' }));
      }
      var grid = H.el('div');
      grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:9px;';
      // 「无背景」项
      var none = H.el('div');
      none.style.cssText = 'position:relative; aspect-ratio:16/10; border-radius:14px; cursor:pointer;'
        + 'background:linear-gradient(150deg,#FFF3F8,#EFF3FB); border:1.5px solid '
        + (!K.state.assets.currentBackgroundId ? 'rgba(217,127,168,0.7)' : 'rgba(190,180,195,0.24)') + ';'
        + 'display:flex; align-items:center; justify-content:center; color:#B0728F;';
      none.innerHTML = '<span style="font-size:10.6px; font-weight:800;">默认流光底</span>';
      none.onclick = function () {
        K.setCurrentBackground(null);
        App.render();
        H.closeAllLayers();
      };
      grid.appendChild(none);

      list.forEach(function (b) {
        var on = K.state.assets.currentBackgroundId === b.id;
        var cell = H.el('div');
        cell.style.cssText = 'position:relative; aspect-ratio:16/10; border-radius:14px; overflow:hidden;'
          + 'cursor:pointer; border:1.6px solid ' + (on ? 'rgba(217,127,168,0.8)' : 'rgba(190,180,195,0.24)') + ';'
          + 'box-shadow:' + (on ? '0 8px 22px rgba(217,127,168,0.28)' : '0 4px 12px rgba(150,120,150,0.10)') + ';';
        var im = H.el('img', { alt: '' });
        im.src = b.src;
        im.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        cell.appendChild(im);
        var tag = H.el('div');
        tag.style.cssText = 'position:absolute; left:0; right:0; bottom:0; padding:5px 7px;'
          + 'background:linear-gradient(180deg,transparent,rgba(40,24,36,0.8));';
        tag.innerHTML = '<div style="font-size:9.8px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden;'
          + 'text-overflow:ellipsis;">' + U.esc(b.name) + '</div>'
          + '<div style="font-size:8.4px; color:rgba(255,255,255,0.72);">' + U.esc(b.scene) + '</div>';
        cell.appendChild(tag);
        if (on) {
          var dot = H.el('span');
          dot.style.cssText = 'position:absolute; right:6px; top:6px; width:18px; height:18px; border-radius:50%;'
            + 'background:#D97FA8; color:#fff; display:flex; align-items:center; justify-content:center;';
          dot.innerHTML = H.icon('check', 11, { strokeWidth: 3 });
          cell.appendChild(dot);
        }
        cell.onclick = function () {
          K.setCurrentBackground(b.id);
          H.toast('场景已切换：' + b.name);
          App.render();
          H.closeAllLayers();
        };
        grid.appendChild(cell);
      });
      body.appendChild(grid);

      H.sheet({
        title: '切换背景',
        subtitle: '主页看板与 VN 剧情引擎共用这套场景',
        icon: 'bg',
        height: '80%',
        slot: 'bg-picker',
        content: body,
        buttons: [
          {
            text: '调整立绘与背景', icon: 'hand', kind: 'primary',
            onClick: function () {
              H.closeAllLayers();
              HG.Portraits.openFitEditor(function () { App.render(); });
            }
          },
          {
            // 「上传新背景」原本和管理场景里的上传是同一个入口，冗余（用户 2026-09-11 指出）
            text: '管理 / 上传场景', icon: 'portrait', kind: 'soft', soft: '#EDF2FB', color: '#5f7aa8',
            onClick: function () {
              H.closeAllLayers();
              HG.Portraits.openBackgroundManager(function () { App.render(); });
            }
          }
        ]
      });
    },

    // ------------------------------------------------------------------
    //  1.4 事件订阅
    // ------------------------------------------------------------------

    subscribe: function () {
      // 清理旧订阅（重复 render 时避免叠加）
      App._unsubs.forEach(function (fn) { try { fn(); } catch (e) { } });
      App._unsubs = [];
      var K = HG.K;
      // 钱包 / 好感 / 模式变化时刷新左上角面板
      App._unsubs.push(K.on('affinity', function () { App.renderAffinityPanel(); }));
      App._unsubs.push(K.on('wallet', function () { App.renderAffinityPanel(); }));
      App._unsubs.push(K.on('verdict', function () { App.renderAffinityPanel(); }));
      App._unsubs.push(K.on('mode', function () { App.render(); }));
    }
  };

  // ==========================================================================
  //  2. 对外入口
  // ==========================================================================

  /**
   * 心动游戏：初始化入口（openApp('heartgame') 会调到这里）
   * 每次打开都重建视图，但全局事件只绑定一次。
   * 真正的界面挂在 #heartgame-mount（id="heartgame-mount"）。
   */
  /**
   * 取用户可识别的「应用版本号」＝更新日志最新一条（如 v4.40）。
   * 这个号在设置-更新日志里也看得到，方便一眼对齐「设备上跑的是哪一版」。
   */
  function appVersionLabel() {
    try {
      if (typeof CHANGELOG_DATA !== 'undefined' && CHANGELOG_DATA && CHANGELOG_DATA[0] && CHANGELOG_DATA[0].version) {
        return CHANGELOG_DATA[0].version;
      }
    } catch (e) { }
    try {
      if (window.CHANGELOG_DATA && window.CHANGELOG_DATA[0]) return window.CHANGELOG_DATA[0].version;
    } catch (e) { }
    return '';
  }

  /**
   * 心动游戏：初始化入口（openApp('heartgame') 会调到这里）
   * 每次打开都重建视图，但全局事件只绑定一次。
   * 真正的界面挂在 #heartgame-mount（id="heartgame-mount"）。
   */
  window.initHeartGameApp = function () {
    // 把版本号打到标题栏，方便一眼确认设备上跑的是哪一版
    // （排查「改了没生效 / 打不开」时，第一步永远是确认版本）
    try {
      var appV = appVersionLabel();
      if (appV) document.title = '叙事诗小手机 · ' + appV;
    } catch (e) { }
    // 同步异常也必须可见：以前只有 Promise 的 catch，
    // 若同步阶段抛错就会「点了图标毫无反应」，非常难排查。
    try {
      App._heartgameBooted = true;
      App.boot().catch(function (e) {
        App.showBootFailure(e);
      });
    } catch (e) {
      App.showBootFailure(e);
    }
  };

  /** 启动失败：把真实原因写到页面上（而不是留一片空白） */
  App.showBootFailure = function (e) {
    App.bootError = (e && e.message) ? e.message : String(e);
    console.error('[心动游戏] 启动失败:', e);
    var body = document.getElementById('heartgame-body');
    if (!body) return;
    if (window.HeartGame && window.HeartGame.H) {
      var box = window.HeartGame.H.empty(
        '心动游戏启动失败：' + App.bootError + '\n\n（请把这段提示反馈给开发者）',
        { icon: 'info' });
      box.style.whiteSpace = 'pre-wrap';
      body.innerHTML = '';
      body.appendChild(box);
    } else {
      body.style.padding = '24px';
      body.textContent = '心动游戏启动失败：' + App.bootError;
    }
  };

  // 入口挂载点常量（供自检与外部集成引用）
  App.MOUNT_ID = 'heartgame-mount';
  App.PLACEHOLDER_MOUNT_ID = 'placeholder-mount';

  /**
   * 占位图标：预留给下一个功能的入口
   */
  window.initPlaceholderApp = function () {
    const closeBtn = document.getElementById('placeholder-close-btn');
    if (closeBtn) closeBtn.onclick = () => { if (typeof closeApp === 'function') closeApp('placeholder'); };

    const body = document.getElementById('placeholder-body');
    renderStubPage(body, {
      title: '占位图标',
      desc: '这是一个预留的入口，等你决定下一个功能放什么，直接把它接在这里就行。',
      accent: '#7E97C9',
      soft: '#EDF2FB',
      mountId: 'placeholder-mount',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
      bullets: [
        '图标、桌面落位、路由与设置里的图标位都已就绪',
        '改名只需改 app_desktop.js 里的 name 与 index.html 里的标题'
      ]
    });
  };

  /** 调试 / 外部集成用 */
  window.heartGameApp = App;

  // ==========================================================================
  //  3. 主页动作表（配合 App.bindActions 的捕获阶段委托）
  //     每个动作都是「打开某个面板」这一类单一职责，便于排障与单测。
  // ==========================================================================
  App.ACTIONS = {
    'page-back':    function () { App.backToLobby(); },
    'rail-task':    function () { HG.Panels.openTasks(); },
    'rail-shop':    function () { HG.Panels.openShop(); },
    'rail-bond':    function () { HG.Panels.openBond(); },
    'rail-story':   function () { HG.Story.open(); },
    'tool-exit':    function () { App.exit(); },
    'tool-admin':   function () { HG.Portraits.openAdmin(function () { App.render(); }); },
    'tool-portrait': function () { HG.Portraits.openManager(function () { App.render(); }); },
    'tool-quiet':   function () { HG.Quiet.open(); },
    'gacha':        function () { HG.Gacha.open(); },
    'char-switch':  function () { App.openCharSwitcher(); },
    'bg-picker':    function () { App.openBackgroundDrawer(); },
    'aff-expand':   function () {
      try { localStorage.setItem('hg-affinity-collapsed', '0'); } catch (e) { }
      App.renderAffinityPanel();
    },
    'aff-collapse': function () {
      try { localStorage.setItem('hg-affinity-collapsed', '1'); } catch (e) { }
      App.renderAffinityPanel();
    },
    'aff-quick': function (node) {
      var n = parseInt(node.getAttribute('data-delta'), 10) || 0;
      HG.K.nudgeVerdict(n);
      App.renderAffinityPanel();
      HG.H.floatText((n > 0 ? '+' : '') + n, { host: node.parentNode, x: '70%', y: '20%', color: n > 0 ? '#D97FA8' : '#7E97C9' });
    },
    'aff-mood':     function () { App.openMoodPicker(); },
    'aff-goto':     function () { HG.Panels.openBond('ladder'); }
  };

  // ==========================================================================
  //  4. 看板内视图路由（v1.5.35）
  //     注册之后，任务 / 商店 / 牵绊三个入口不再开 body 级抽屉，而是在
  //     #heartgame-mount 里换一页 —— 从根上解决「连点叠两层」与「层级被压住看不见」。
  // ==========================================================================
  HG.H.pageRouter = function (kind, arg) {
    if (!HG.Panels || !HG.Panels.pages || typeof HG.Panels.pages[kind] !== 'function') return false;
    App.setView(kind, arg);
    return true;
  };
})();
