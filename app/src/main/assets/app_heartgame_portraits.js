/**
 * app_heartgame_portraits.js - 心动游戏 · 立绘与背景管理器 (P)
 * ============================================================================
 * 职责：
 *   1. 资产格式支持：Live2D（moc3 / model3.json 模型包）与静态高清 PNG/WebP 立绘、场景背景
 *   2. 多立绘轮换：单角色绑定多套服装 / 形态，可设为「当前主页展示」
 *   3. 热区涂抹划分：可视化掩码编辑画布（头发 / 面部 / 颈部 / 胸腹 / 手部 / 腿部 …）
 *      并绑定各热区的交互等级与好感阶段响应动作库
 *   4. 场景背景管理：自定义背景 + 场景属性标注（雨天 / 卧室 / 校园 / 黄昏 …）
 *   5. 资源池与生命周期：统一 LRU 缓存 + 页面销毁时主动卸载（杜绝内存溢出）
 *
 * 依赖：window.HeartGame.K / .H / .U / .C（app_heartgame_core.js）
 * 工程红线同 core：纯经典脚本 / 无 emoji / 无原生弹窗 / 淡彩配色 / LF
 */
(function () {
  'use strict';

  var HG = window.HeartGame;
  if (!HG) { console.warn('[心动游戏] core 未加载，立绘管理器已跳过'); return; }
  var K = HG.K, H = HG.H, U = HG.U, C = HG.C;

  // ==========================================================================
  //  1. 资源池（LRU）：所有大图 / 模型都经此进出，页面销毁时可整体卸载
  // ==========================================================================

  function AssetPool(limit) {
    this.limit = limit || C.ASSET_POOL_LIMIT || 8;
    this.map = Object.create(null);   // key -> {key, kind, url, bytes, at}
    this.order = [];                  // 最近使用在前
  }

  /** 登记一份资源；超出上限时回收最久未使用的（若是 blob URL 主动 revoke） */
  AssetPool.prototype.acquire = function (key, entry) {
    var rec = this.map[key];
    if (rec) {
      this._promote(key);
      rec.at = Date.now();
      return rec;
    }
    rec = {
      key: key,
      kind: (entry && entry.kind) || 'image',
      url: (entry && entry.url) || '',
      bytes: (entry && entry.bytes) || 0,
      objectUrl: !!(entry && entry.objectUrl),
      at: Date.now()
    };
    this.map[key] = rec;
    this.order.unshift(key);
    this._evict();
    return rec;
  };

  AssetPool.prototype.get = function (key) {
    var rec = this.map[key];
    if (rec) this._promote(key);
    return rec || null;
  };

  AssetPool.prototype._promote = function (key) {
    var i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
    this.order.unshift(key);
  };

  /** 回收：只回收真正的内存占用（blob URL / Live2D 实例），用户数据留在 IndexedDB 不动 */
  AssetPool.prototype.release = function (key) {
    var rec = this.map[key];
    if (!rec) return false;
    if (rec.objectUrl && rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) {} }
    if (rec.kind === 'live2d' && rec.instance && typeof rec.instance.destroy === 'function') {
      try { rec.instance.destroy(); } catch (e) {}
    }
    delete this.map[key];
    var i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
    return true;
  };

  AssetPool.prototype._evict = function () {
    while (this.order.length > this.limit) {
      var drop = this.order[this.order.length - 1];
      this.release(drop);
    }
  };

  /** 页面销毁：清空全部 */
  AssetPool.prototype.clear = function () {
    var self = this;
    this.order.slice().forEach(function (k) { self.release(k); });
    this.map = Object.create(null);
    this.order = [];
  };

  AssetPool.prototype.stats = function () {
    var bytes = 0, self = this;
    this.order.forEach(function (k) { bytes += (self.map[k] && self.map[k].bytes) || 0; });
    return { count: this.order.length, limit: this.limit, bytes: bytes };
  };

  // ==========================================================================
  //  2. Live2D 运行时加载器
  //     —— 项目本身不内置 Cubism 运行时（体积 / 授权原因），因此这里做成
  //        「可配置 URL 的按需加载 + 静态立绘兜底」：用户给出运行时地址即可启用
  //        Live2D；没有运行时则无缝回落到 2D 立绘 + CSS 物理动效，功能不降级。
  // ==========================================================================

  var Live2DLoader = {
    RUNTIME_KEY: 'hg-live2d-runtime-url',
    SCRIPT_KEY: 'hg-live2d-script-url',
    SCRIPTS_KEY: 'hg-live2d-scripts',
    _loading: null,
    _ready: false,
    _lastError: '',

    /**
     * 官方推荐运行时（**已实测跑通 Cubism 4/5 的 .moc3 模型**，顺序不能变）：
     *   ① Cubism 4 Core —— 解析 .moc3
     *   ② PIXI v6       —— 渲染底座
     *   ③ pixi-live2d-display(cubism4) —— 把模型接进 PIXI
     *
     * 重要：网上广为流传的 live2d-widget 的 `live2d.min.js` 是 **Cubism 2 内核**，
     * 只能读 .moc（Cubism 2.1），**读不了现在绝大多数模型用的 .moc3**。
     * 用户填了它会看到"检测成功"，但模型永远出不来 —— 这正是之前的坑。
     */
    PRESET: [
      'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
      'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
      'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js'
    ],

    runtimeUrl: function () {
      try { return localStorage.getItem(Live2DLoader.RUNTIME_KEY) || ''; } catch (e) { return ''; }
    },
    setRuntimeUrl: function (url) {
      try { localStorage.setItem(Live2DLoader.RUNTIME_KEY, String(url || '')); } catch (e) { }
    },

    /** 运行时脚本地址列表（有序） */
    scripts: function () {
      try {
        var raw = localStorage.getItem(Live2DLoader.SCRIPTS_KEY);
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            return arr.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
          }
        }
      } catch (e) { }
      try {
        var one = localStorage.getItem(Live2DLoader.SCRIPT_KEY) || '';
        return one.trim() ? [one.trim()] : [];
      } catch (e) { return []; }
    },
    setScripts: function (list) {
      var arr = (list || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
      try { localStorage.setItem(Live2DLoader.SCRIPTS_KEY, JSON.stringify(arr)); } catch (e) { }
      Live2DLoader._ready = false;
      Live2DLoader._loading = null;
      Live2DLoader._lastError = '';
    },
    // —— 兼容旧接口（单地址）——
    scriptUrl: function () { return Live2DLoader.scripts()[0] || ''; },
    setScriptUrl: function (u) { Live2DLoader.setScripts(u ? [u] : []); },
    /** 一键填入推荐运行时 */
    usePreset: function () { Live2DLoader.setScripts(Live2DLoader.PRESET); return Live2DLoader.PRESET.slice(); },

    /**
     * 当前实际可用的运行时形态
     *   'cubism4' = PIXI + pixi-live2d-display（能读 .moc3，现代模型走这条）
     *   'cubism2' = 老式 Live2D.loadModel + Live2DModelWebGL（只能读 .moc）
     *   'none'
     */
    runtime: function () {
      if (window.PIXI && window.PIXI.live2d && window.PIXI.live2d.Live2DModel) return 'cubism4';
      if (window.Live2D && typeof window.Live2D.loadModel === 'function'
        && typeof window.Live2DModelWebGL === 'function') return 'cubism2';
      return 'none';
    },

    available: function () { return Live2DLoader.runtime() !== 'none'; },

    /** 诊断快照：面板直接显示，避免再出现"提示成功但没立绘" */
    diagnose: function () {
      var gl = false;
      try {
        var c = document.createElement('canvas');
        gl = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
      } catch (e) { }
      return {
        runtime: Live2DLoader.runtime(),
        scripts: Live2DLoader.scripts(),
        hasCubismCore: typeof window.Live2DCubismCore !== 'undefined',
        hasPixi: typeof window.PIXI !== 'undefined',
        hasPixiLive2d: !!(window.PIXI && window.PIXI.live2d && window.PIXI.live2d.Live2DModel),
        hasCubism2: typeof window.Live2D !== 'undefined',
        webgl: gl,
        error: Live2DLoader._lastError
      };
    },

    /**
     * 同一个文件的多路镜像。国内网络下 jsdelivr 经常抽风，
     * 主地址失败就依次换 fastly / unpkg（三个都是同一份 npm 包）。
     */
    mirrorsOf: function (url) {
      var out = [url];
      if (/^https:\/\/cdn\.jsdelivr\.net\//.test(url)) {
        out.push(url.replace('https://cdn.jsdelivr.net/', 'https://fastly.jsdelivr.net/'));
        out.push(url.replace('https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'));
      }
      return out;
    },

    /** 逐个按顺序加载脚本；任何一步失败都只记录原因，不抛错 */
    ensure: function () {
      if (Live2DLoader.available()) { Live2DLoader._ready = true; return Promise.resolve(true); }
      if (Live2DLoader._loading) return Live2DLoader._loading;
      var list = Live2DLoader.scripts();
      if (!list.length) {
        Live2DLoader._lastError = '还没有填运行时地址';
        return Promise.resolve(false);
      }
      var loadAt = function (url) {
        var cands = Live2DLoader.mirrorsOf(url);
        var tryOne = function (i) {
          if (i >= cands.length) return Promise.resolve(false);
          return new Promise(function (resolve) {
            var s = document.createElement('script');
            var done = false;
            var fin = function (ok) { if (done) return; done = true; resolve(ok); };
            s.src = cands[i];
            s.async = false;
            s.onload = function () { fin(true); };
            s.onerror = function () { fin(false); };
            setTimeout(function () { fin(true); }, 15000);   // 超时也放行，交给最终 available() 判定
            document.head.appendChild(s);
          }).then(function (ok) { return ok ? true : tryOne(i + 1); });
        };
        return tryOne(0).then(function (ok) {
          if (!ok) Live2DLoader._lastError = '脚本加载失败（主地址与镜像都试过）-> ' + url;
          return ok;
        });
      };
      var chain = Promise.resolve();
      list.forEach(function (u) { chain = chain.then(function () { return loadAt(u); }); });
      Live2DLoader._loading = chain.then(function () {
        Live2DLoader._ready = Live2DLoader.available();
        if (!Live2DLoader._ready) {
          Live2DLoader._lastError = Live2DLoader._lastError
            || '脚本加载完了，但没有检测到 Live2D 全局对象（地址可能不是 Live2D 运行时）';
        } else {
          Live2DLoader._lastError = '';
        }
        return Live2DLoader._ready;
      });
      return Live2DLoader._loading;
    },

    /**
     * 在容器里创建 Live2D 实例。
     * @param {HTMLCanvasElement} canvas
     * @param {string} modelUrl 模型入口（model3.json / model.json 的地址）
     * @param {HTMLElement} host 容器（用于自适应尺寸）
     * @returns {Promise<object|null>} 实例或 null（null 表示回落静态立绘）
     */
    mount: function (canvas, modelUrl, host) {
      return Live2DLoader.ensure().then(function (ok) {
        if (!ok || !modelUrl) {
          if (!modelUrl) Live2DLoader._lastError = '这个立绘没有模型地址';
          return null;
        }
        var rt = Live2DLoader.runtime();
        if (rt === 'cubism4') return Live2DLoader._mountCubism4(canvas, modelUrl, host);
        if (rt === 'cubism2') return Live2DLoader._mountCubism2(canvas, modelUrl);
        Live2DLoader._lastError = '没有可用的 Live2D 运行时';
        return null;
      }).catch(function (e) {
        Live2DLoader._lastError = (e && e.message) ? e.message : String(e);
        console.warn('[心动游戏] Live2D 挂载失败:', e);
        return null;
      });
    },

    /**
     * Cubism 4/5：PIXI + pixi-live2d-display
     * 定位用 anchor(0.5, 1)（底部中心对齐），正是看板要的"站在底边、水平居中"。
     * 注意 anchor 必须在 scale 之前设 —— 模型加载后 width/height 是**未缩放**的，
     * 设完 scale 再读就会拿到缩放后的值，位置会算错（我实测踩过：模型被放到画布外面）。
     */
    _mountCubism4: async function (canvas, modelUrl, host) {
      var PIXI = window.PIXI;
      var w = (host && host.clientWidth) || canvas.clientWidth || 390;
      var h = (host && host.clientHeight) || canvas.clientHeight || 700;
      var app = new PIXI.Application({
        view: canvas,
        width: Math.max(1, w),
        height: Math.max(1, h),
        backgroundAlpha: 0,
        antialias: true,
        autoStart: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
      });
      var model = await PIXI.live2d.Live2DModel.from(modelUrl, { autoInteract: false });
      var natW = model.width, natH = model.height;   // 未缩放尺寸，先存下来
      model.anchor.set(0.5, 1);
      app.stage.addChild(model);

      var fit = function () {
        var cw = (host && host.clientWidth) || w;
        var ch = (host && host.clientHeight) || h;
        if (!cw || !ch) return;
        try { app.renderer.resize(cw, ch); } catch (e) { }
        var s = (ch / natH) * 0.99;
        model.scale.set(s);
        model.position.set(cw / 2, ch);
      };
      fit();

      // 容器尺寸变化（横竖屏 / 工具栏高度变化）时重新贴合
      var onResize = function () { fit(); };
      window.addEventListener('resize', onResize);
      try {
        if (typeof ResizeObserver === 'function' && host) {
          var ro = new ResizeObserver(function () { fit(); });
          ro.observe(host);
          onResize._ro = ro;
        }
      } catch (e) { }

      Live2DLoader._lastError = '';
      return {
        kind: 'live2d',
        engine: 'cubism4',
        app: app,
        model: model,
        update: function () { },
        refit: fit,
        /** 表情名与模型里的 exp3 文件名一致（导入时已自动识别） */
        setExpression: function (name) {
          try { if (name) model.expression(name); } catch (e) { }
        },
        motion: function (group, index) {
          try { model.motion(group || 'Idle', index || 0); } catch (e) { }
        },
        destroy: function () {
          try { window.removeEventListener('resize', onResize); } catch (e) { }
          try { if (onResize._ro) onResize._ro.disconnect(); } catch (e) { }
          try { model.destroy(); } catch (e) { }
          try { app.destroy(false, { children: true, texture: false }); } catch (e) { }
        }
      };
    },

    /** Cubism 2（老式 .moc 模型）：保留原有实现 */
    _mountCubism2: function (canvas, modelUrl) {
      try {
        var model = window.Live2D.loadModel(modelUrl);
        if (!model) { Live2DLoader._lastError = 'Cubism2 无法解析这个模型（.moc3 模型需要 Cubism4 运行时）'; return null; }
        var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { Live2DLoader._lastError = '没有 WebGL 上下文'; return null; }
        var glModel = new window.Live2DModelWebGL(canvas);
        glModel.loadModel(model);
        var raf = null, alive = true;
        var start = Date.now();
        var tick = function () {
          if (!alive) return;
          var t = (Date.now() - start) / 1000;
          try {
            glModel.setParamFloat('PARAM_ANGLE_X', 12 * Math.sin(t * 0.5));
            glModel.setParamFloat('PARAM_ANGLE_Y', 6 * Math.sin(t * 0.42));
            glModel.setParamFloat('PARAM_BREATH', 0.5 + 0.5 * Math.sin(t * 1.1));
          } catch (e) { }
          try { glModel.updateParam(); glModel.update(); } catch (e) { }
          raf = requestAnimationFrame(tick);
        };
        tick();
        return {
          kind: 'live2d',
          engine: 'cubism2',
          update: function () { },
          setExpression: function () { },
          destroy: function () {
            alive = false;
            if (raf) cancelAnimationFrame(raf);
            try { glModel.releaseModel && glModel.releaseModel(); } catch (e) { }
          }
        };
      } catch (e) {
        Live2DLoader._lastError = (e && e.message) ? e.message : String(e);
        return null;
      }
    }
  };

  // ==========================================================================
  //  2.5 ZIP 模型包导入（Live2D 最省事的用法）
  //      用户手上通常是「一个 zip 里塞着 moc3 + model3.json + 贴图 + 物理」，
  //      所以这里引入 JSZip，把整包解成内存文件表 → 每个文件生成 blob URL →
  //      把 model3.json 里的相对路径改写成 blob URL → 得到一个可直接加载的模型入口。
  //      JSZip 按需从 CDN 拉（与 dexie 同源 unpkg，已进 SW 缓存），失败不阻塞其它功能。
  // ==========================================================================

  var ZipModel = {
    CDN: 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    _loading: null,
    _ready: false,

    /** 是否已具备 JSZip */
    available: function () { return typeof window.JSZip !== 'undefined' && !!window.JSZip; },

    /**
     * 按需加载 JSZip（本地没有就从 CDN 拉一次）
     * @returns {Promise<boolean>}
     */
    ensure: function () {
      if (ZipModel.available()) { ZipModel._ready = true; return Promise.resolve(true); }
      if (ZipModel._loading) return ZipModel._loading;
      ZipModel._loading = new Promise(function (resolve) {
        var s = document.createElement('script');
        var done = false;
        var finish = function (ok) {
          if (done) return; done = true;
          ZipModel._ready = !!ok;
          if (!ok) console.warn('[心动游戏] JSZip 加载失败，zip 导入不可用');
          resolve(!!ok);
        };
        s.src = ZipModel.CDN;
        s.async = true;
        s.onload = function () { finish(ZipModel.available()); };
        s.onerror = function () { finish(false); };
        setTimeout(function () { finish(ZipModel.available()); }, 15000);
        (document.head || document.documentElement).appendChild(s);
      });
      return ZipModel._loading;
    },

    /** 取相对路径的目录名（'' 或 'foo/' 或 'a/b/'） */
    _dirOf: function (p) {
      var i = String(p).lastIndexOf('/');
      return i >= 0 ? String(p).slice(0, i + 1) : '';
    },

    /** 归一化 zip 内路径（去 ./、去前导 /） */
    _norm: function (p) {
      return String(p || '').replace(/^\.\//, '').replace(/^\/+/, '');
    },

    /** 以 base 为基准解析相对路径 */
    _resolve: function (base, rel) {
      if (/^(https?:|blob:|data:)/i.test(rel)) return rel;
      var stack = (base + rel).split('/');
      var out = [];
      for (var i = 0; i < stack.length; i++) {
        var seg = stack[i];
        if (seg === '' && i > 0) continue;
        if (seg === '.') continue;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
      }
      return out.join('/');
    },

    /** MIME */
    _mime: function (name) {
      var n = String(name).toLowerCase();
      if (/\.json$/.test(n)) return 'application/json';
      if (/\.moc3?$/.test(n)) return 'application/octet-stream';
      if (/\.png$/.test(n)) return 'image/png';
      if (/\.jpe?g$/.test(n)) return 'image/jpeg';
      if (/\.webp$/.test(n)) return 'image/webp';
      if (/\.(mp3|wav|m4a|ogg)$/.test(n)) return 'audio/mpeg';
      return 'application/octet-stream';
    },

    /**
     * 包里没有 model3.json 时，按实际文件合成一份。
     * （VTube Studio 导出的模型包经常只有 moc3 + 贴图 + physics3/exp3/cdi3）
     * 合成不出来就返回 null —— 由调用方回落到「用包里最大的一张图当静态立绘」。
     * @returns {Promise<{path:string, json:object}|null>}
     */
    _synthModel3: async function (entries, mocPath) {
      var dir = ZipModel._dirOf(mocPath);
      var inDir = entries.filter(function (e) { return ZipModel._dirOf(e.path) === dir; });
      var base = function (p) { return String(p).split('/').pop(); };
      var mocName = base(mocPath);
      var stem = mocName.replace(/\.moc3$/i, '');

      var imgs = inDir.filter(function (e) { return /\.(png|jpe?g|webp)$/i.test(e.path); });
      var texNamed = imgs.filter(function (e) { return /^texture[_\-]?\d*\.(png|jpe?g|webp)$/i.test(base(e.path)); })
        .sort(function (a, b) { return base(a.path).localeCompare(base(b.path)); });
      // 与模型同名的 png 通常是 VTube Studio 的预览图而不是贴图，优先排除
      var textures = texNamed.length ? texNamed
        : imgs.filter(function (e) { return base(e.path).replace(/\.[^.]+$/, '') !== stem; });
      if (!textures.length) textures = imgs;
      if (!textures.length) return null;

      var one = function (re) {
        var f = inDir.filter(function (e) { return re.test(e.path); })[0];
        return f ? base(f.path) : null;
      };

      var fr = { Moc: mocName, Textures: textures.map(function (e) { return base(e.path); }) };
      var phys = one(/\.physics3\.json$/i); if (phys) fr.Physics = phys;
      var pose = one(/\.pose3\.json$/i); if (pose) fr.Pose = pose;
      var cdiName = one(/\.cdi3\.json$/i); if (cdiName) fr.DisplayInfo = cdiName;

      var exps = inDir.filter(function (e) { return /\.exp3\.json$/i.test(e.path); })
        .sort(function (a, b) { return base(a.path).localeCompare(base(b.path)); });
      if (exps.length) {
        fr.Expressions = exps.map(function (e) {
          return { Name: base(e.path).replace(/\.exp3\.json$/i, ''), File: base(e.path) };
        });
      }

      var motions = inDir.filter(function (e) { return /\.motion3\.json$/i.test(e.path); });
      if (motions.length) {
        var groups = {};
        motions.forEach(function (e) {
          var n = base(e.path).replace(/\.motion3\.json$/i, '');
          var g = n.replace(/[_-]?\d+$/, '') || 'Idle';
          (groups[g] = groups[g] || []).push({ File: base(e.path) });
        });
        fr.Motions = Object.keys(groups).map(function (g) { return { File: groups[g] }; });
      }

      // 从 cdi3.json 读出 EyeBlink / LipSync 的参数名，眨眼与口型才正常
      var groupsCfg = [];
      var cdiEntry = inDir.filter(function (e) { return /\.cdi3\.json$/i.test(e.path); })[0];
      if (cdiEntry && cdiEntry.entry && cdiEntry.entry.async) {
        try {
          var cdi = JSON.parse(await cdiEntry.entry.async('string'));
          var gp = {};
          (cdi.Parameters || []).forEach(function (p) {
            if (!p || !p.GroupId || !p.Id) return;
            (gp[p.GroupId] = gp[p.GroupId] || []).push(p.Id);
          });
          ['EyeBlink', 'LipSync'].forEach(function (g) {
            if (gp[g] && gp[g].length) groupsCfg.push({ Target: 'Parameter', Name: g, Ids: gp[g] });
          });
        } catch (e) { }
      }

      return {
        path: dir + stem + '.model3.json',
        json: { Version: 3, FileReferences: fr, Groups: groupsCfg, HitAreas: [] }
      };
    },

    /**
     * 解析一个 zip 模型包
     * @param {File|Blob} file
     * @param {Function} onProgress (stage, detail)
     * @returns {Promise<{ name, jsonPath, entryUrl, fileCount, files:[{path,url,size}], _urls }>}
     */
    parse: async function (file, onProgress) {
      var report = function (s, d) { if (typeof onProgress === 'function') onProgress(s, d); };
      report('loading-lib', '正在准备解压组件…');
      var haveLib = await ZipModel.ensure();
      if (!haveLib) throw new Error('解压组件加载失败（JSZip CDN 不可达），请检查网络后重试');

      report('reading', '正在读取压缩包…');
      var zip = await window.JSZip.loadAsync(file);

      // 收集全部文件
      var entries = [];
      zip.forEach(function (path, entry) {
        if (entry.dir) return;
        var p = ZipModel._norm(path);
        if (!p || /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p) || /(^|\/)\.DS_Store$/.test(p)) return;
        entries.push({ path: p, entry: entry });
      });
      if (!entries.length) throw new Error('压缩包里没有找到任何文件');

      report('extracting', '正在解出 ' + entries.length + ' 个文件…');
      var urls = {};      // path -> blobURL
      var files = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var blob = await e.entry.async('blob');
        var typed = new Blob([blob], { type: ZipModel._mime(e.path) });
        var u = URL.createObjectURL(typed);
        urls[e.path] = u;
        files.push({ path: e.path, url: u, size: typed.size });
      }

      // 找模型入口：优先 model3.json
      var mocPaths = entries.filter(function (e) { return /\.moc3$/i.test(e.path); }).map(function (e) { return e.path; });
      var jsonCandidates = entries.filter(function (e) { return /\.model3\.json$/i.test(e.path); });

      // ★ 没有 model3.json 时自动合成一份。
      //   VTube Studio 导出的模型包经常只有 moc3 + 贴图 + physics3/exp3/cdi3，
      //   用户导入后只会看到「没有立绘」——之前就是掉进这里（还会误选 xyplugin.json 之类的杂项 json）。
      var synthesized = false;
      if (!jsonCandidates.length && mocPaths.length) {
        report('synthesizing', '没有 model3.json，正在按包内文件自动生成模型描述…');
        var synth = await ZipModel._synthModel3(entries, mocPaths[0]);
        if (synth) {
          var synthEntry = { path: synth.path, _json: synth.json, synthesized: true };
          entries.push(synthEntry);
          jsonCandidates = [synthEntry];
          synthesized = true;
        }
      }
      // 兜底：仍然没有就退回到「任何 .json」，但**排除** VTube Studio 的附属文件，
      // 否则会把 items_pinned_to_model.json 当成模型入口（点了没反应，也没有任何报错）
      if (!jsonCandidates.length) {
        jsonCandidates = entries.filter(function (e) {
          if (!/\.json$/i.test(e.path)) return false;
          return !/(^|\/)(items_pinned_to_model|.*\.xyplugin|.*\.vtube)\.json$/i.test(e.path);
        });
      }
      // 优先选「同目录下存在 .moc3」的那个 json
      var jsonEntry = null;
      for (var j = 0; j < jsonCandidates.length; j++) {
        var dir = ZipModel._dirOf(jsonCandidates[j].path);
        if (mocPaths.some(function (m) { return ZipModel._dirOf(m) === dir; })) { jsonEntry = jsonCandidates[j]; break; }
      }
      if (!jsonEntry) jsonEntry = jsonCandidates[0];
      if (!jsonEntry) {
        throw new Error(mocPaths.length
          ? '找到了 moc3 模型文件，但没能生成模型描述（请确认包里有贴图 png）'
          : '这个压缩包里没有 .moc3 模型文件，可能不是 Live2D 模型包');
      }

      report('rewriting', '正在改写模型内的资源引用…');
      var jsonText = jsonEntry._json ? JSON.stringify(jsonEntry._json) : await jsonEntry.entry.async('string');
      var model = null;
      try { model = JSON.parse(jsonText); } catch (e) { model = null; }
      if (!model) throw new Error('model3.json 解析失败（文件可能已损坏）');

      var baseDir = ZipModel._dirOf(jsonEntry.path);
      var selfBase = jsonEntry.path;
      var mapped = 0, missing = [];

      var mapPath = function (rel) {
        if (!rel || typeof rel !== 'string') return rel;
        if (/^(https?:|blob:|data:)/i.test(rel)) return rel;
        var target = ZipModel._resolve(baseDir, ZipModel._norm(rel));
        if (urls[target]) { mapped++; return urls[target]; }
        // 有些包会把路径写成含自身文件名前缀，再试一次去前缀
        var alt = ZipModel._resolve(baseDir, ZipModel._norm(rel.replace(/^[^/]*\.model3\.json\//, '')));
        if (urls[alt]) { mapped++; return urls[alt]; }
        missing.push(rel);
        return rel;
      };

      try {
        if (model.FileReferences) {
          var fr = model.FileReferences;
          if (fr.Moc) fr.Moc = mapPath(fr.Moc);
          if (Array.isArray(fr.Textures)) fr.Textures = fr.Textures.map(mapPath);
          if (Array.isArray(fr.Physics)) fr.Physics = fr.Physics.map(mapPath);
          if (Array.isArray(fr.Pose)) fr.Pose = fr.Pose.map(mapPath);
          if (Array.isArray(fr.Expressions)) {
            fr.Expressions.forEach(function (x) { if (x && x.File) x.File = mapPath(x.File); });
          }
          if (Array.isArray(fr.Motions)) {
            fr.Motions.forEach(function (g) {
              if (g && Array.isArray(g.File)) g.File = mapPath(g.File);
            });
          }
          if (fr.DisplayInfo) fr.DisplayInfo = mapPath(fr.DisplayInfo);
        }
      } catch (e2) {
        console.warn('[心动游戏] 模型引用改写时出错（继续用原始路径）:', e2);
      }

      // 入口模型本身也用 blob URL（避免依赖原 zip 路径）
      var entryBlob = new Blob([JSON.stringify(model)], { type: 'application/json' });
      var entryUrl = URL.createObjectURL(entryBlob);
      urls[selfBase] = entryUrl;

      return {
        name: (model && (model.name || (model.FileReferences && model.FileReferences.Moc))) || file.name.replace(/\.zip$/i, ''),
        jsonPath: jsonEntry.path,
        entryUrl: entryUrl,
        fileCount: files.length,
        mocFound: mocPaths.length > 0,
        synthesized: synthesized,
        textureCount: (model && model.FileReferences && Array.isArray(model.FileReferences.Textures))
          ? model.FileReferences.Textures.length : 0,
        // 包里所有图片（按体积从大到小）：模型跑不起来时用它兜底成静态立绘
        images: files.filter(function (f) { return /\.(png|jpe?g|webp)$/i.test(f.path); })
          .sort(function (a, b) { return b.size - a.size; }),
        mapped: mapped,
        missing: missing,
        files: files,
        urls: urls
      };
    },

    /** 释放一次导入占用的 blob URL（页面销毁或换模型时调用） */
    release: function (record) {
      if (!record || !record.urls) return 0;
      var n = 0;
      Object.keys(record.urls).forEach(function (k) {
        try { URL.revokeObjectURL(record.urls[k]); n++; } catch (e) { }
      });
      return n;
    },

    /**
     * 把 blob URL 的图片压缩成 data URL（复用桌面模块的编码器）。
     * 用于「压缩包不能用 -> 拿包里的一张图当静态立绘」的兜底。
     */
    _blobUrlToDataUrl: async function (url, name, maxPx) {
      try {
        var blob = await (await fetch(url)).blob();
        var enc = window.tileEncodeImage;
        if (typeof enc !== 'function') return '';
        var input = blob;
        try { input = new File([blob], name || 'fallback.png', { type: blob.type || 'image/png' }); } catch (e) { }
        var out = await enc(input, maxPx || 1400);
        return out || '';
      } catch (e) {
        console.warn('[心动游戏] 兜底图片编码失败:', e);
        return '';
      }
    },

    /**
     * 模型没能驱动起来时，说清**到底缺什么**（而不是笼统的"已导入"）。
     * 顺带给出包内图片兜底成静态立绘的选项。
     */
    _reportLive2DFailure: function (parsed, created) {
      var d = Live2DLoader.diagnose();
      var lines = [];
      if (!d.webgl) lines.push('· 这台设备的 WebView 没有可用的 WebGL（Live2D 必须要 WebGL）');
      if (d.runtime === 'none') {
        if (!d.scripts.length) {
          lines.push('· 还没有配置 Live2D 运行时代码（本页下方「Live2D 运行时」，点一下"使用推荐运行时"即可）');
        } else if (d.hasCubism2 && !d.hasPixiLive2d) {
          lines.push('· 你填的是 **Cubism 2 内核**（例如 live2d-widget 的 live2d.min.js）——');
          lines.push('  它只能读老式 .moc 模型，**读不了 .moc3**，所以会"检测成功"但永远没有立绘');
          lines.push('· 换成"使用推荐运行时"（Cubism4 Core + PIXI + pixi-live2d-display）就能驱动 .moc3');
        } else {
          lines.push('· 运行时代码没加载成功，请检查地址是否可访问');
        }
      }
      if (d.error) lines.push('· 具体错误：' + d.error);
      if (parsed && parsed.missing && parsed.missing.length) {
        lines.push('· 包内缺少这些被引用的文件：' + parsed.missing.slice(0, 5).join('、'));
      }

      var hasImg = !!(parsed && parsed.images && parsed.images.length);
      H.modal({
        title: '模型已存好，但没能驱动',
        icon: 'info', accent: '#9FB3D9',
        message: '这个模型包已经收下了（' + (parsed ? parsed.fileCount : 0) + ' 个文件'
          + (parsed && parsed.synthesized ? '，model3.json 是自动生成的' : '') + '），\n'
          + '但现在还画不出来，原因：\n\n' + (lines.length ? lines.join('\n') : '· 未知原因（可把这条提示反馈给开发者）')
          + (hasImg ? '\n\n要不要先用包里最大的一张图当静态立绘？之后修好运行时随时可以换回模型。' : ''),
        okText: hasImg ? '用图片兜底' : '知道了',
        cancelText: hasImg ? '先不用' : null
      }).then(function (useImg) {
        if (!useImg || !hasImg) return;
        Portraits._applyImageFallback(parsed.images[0], parsed.name, created);
      });
    },

    /** 把包内的一张图变成一张静态立绘（并且它是新的当前立绘） */
    _applyImageFallback: async function (imgFile, baseName, createdPortrait) {
      if (!imgFile || !imgFile.url) { H.toast('包里没有可用的图片'); return; }
      H.toast('正在把图片转成立绘…');
      var dataUrl = await Portraits._blobUrlToDataUrl(imgFile.url, imgFile.path.split('/').pop(), 1400);
      if (!dataUrl) { H.toast('这张图无法解码，换一张试试'); return; }
      var p = K.addPortrait({
        name: (baseName || '模型包') + ' · 图片',
        kind: 'image',
        src: dataUrl,
        tags: ['zip 兜底']
      });
      // 兜底立绘要立刻用上，否则用户看不到任何变化
      if (p && p.id) K.setCurrentPortrait(p.id);
      H.toast('已用包内图片生成静态立绘');
      if (window.heartGameApp && typeof window.heartGameApp.render === 'function') {
        try { window.heartGameApp.render(); } catch (e) { }
      }
    },

    /** 压缩包整个读不了时的兜底：先告诉用户哪里不对，再问要不要拿图 */
    _offerImageFallback: function (file, reason, onChanged) {
      H.modal({
        title: '这个压缩包用不了',
        icon: 'info', accent: '#c2607c', soft: '#FFEFF3',
        message: reason + '\n\n可以先用包里的一张图当静态立绘（需要你自己再选一次那个 zip）。',
        okText: '选图兜底',
        cancelText: '算了'
      }).then(function (go) {
        if (!go) return;
        Portraits._pickImageFromZip(onChanged);
      });
    },

    /** 让用户重新选一个 zip，并把里面最大的一张图取出来当静态立绘 */
    _pickImageFromZip: function (onChanged) {
      Portraits.pickZip(async function (file) {
        try {
          var haveLib = await ZipModel.ensure();
          if (!haveLib) { H.toast('解压组件不可用（网络问题）'); return; }
          var zip = await window.JSZip.loadAsync(file);
          var best = null;
          var list = [];
          zip.forEach(function (path, entry) {
            if (entry.dir) return;
            var p = ZipModel._norm(path);
            if (!/\.(png|jpe?g|webp)$/i.test(p)) return;
            list.push({ path: p, entry: entry });
          });
          if (!list.length) { H.toast('这个包里一张图片都没有'); return; }
          // 逐张读体积，取最大的一张（通常是贴图，分辨率最高）
          for (var i = 0; i < list.length; i++) {
            var blob = await list[i].entry.async('blob');
            if (!best || blob.size > best.size) best = { path: list[i].path, blob: blob, size: blob.size };
            if (list.length > 24 && i > 24) break;   // 超大包只扫前 25 张，够用了
          }
          if (!best) { H.toast('没找到可用的图片'); return; }
          var enc = window.tileEncodeImage;
          if (typeof enc !== 'function') { H.toast('图片编码器不可用'); return; }
          var input = best.blob;
          try { input = new File([best.blob], best.path.split('/').pop(), { type: best.blob.type || 'image/png' }); } catch (e) { }
          var dataUrl = await enc(input, 1400);
          if (!dataUrl) { H.toast('这张图无法解码'); return; }
          var p = K.addPortrait({
            name: file.name.replace(/\.zip$/i, '') + ' · 图片',
            kind: 'image',
            src: dataUrl,
            tags: ['zip 兜底']
          });
          if (p && p.id) K.setCurrentPortrait(p.id);
          H.toast('已用包里最大的那张图生成立绘');
          if (typeof onChanged === 'function') onChanged();
          if (window.heartGameApp && typeof window.heartGameApp.render === 'function') {
            try { window.heartGameApp.render(); } catch (e) { }
          }
        } catch (e) {
          H.modal({
            title: '读不出来', icon: 'info', accent: '#c2607c', soft: '#FFEFF3',
            message: (e && e.message) ? e.message : String(e)
          });
        }
      });
    }
  };

  // ==========================================================================
  //  3. 静态立绘渲染器（Live2D 不可用时的主力：CSS 物理动效 + 热区触控）
  // ==========================================================================

  /**
   * 纯几何：算出一张图在给定舞台里应该画在哪（v1.5.38）
   * 规则：contain 等比缩放 × 用户的 scale，水平居中 + 用户 offsetX，**底部对齐** + 用户 offsetY。
   * 抽成纯函数是为了能在 Node 里直接单测（不用浏览器）。
   * @returns {{dx:number, dy:number, dw:number, dh:number}}
   */
  function fitRect(boxW, boxH, natW, natH, fit) {
    var f = fit || {};
    var w = boxW > 0 ? boxW : 1, h = boxH > 0 ? boxH : 1;
    var nw = natW > 0 ? natW : 1, nh = natH > 0 ? natH : 1;
    var sc = Math.min(w / nw, h / nh) * (typeof f.scale === 'number' ? f.scale : 1);
    var dw = nw * sc, dh = nh * sc;
    return {
      dx: (w - dw) / 2 + (typeof f.x === 'number' ? f.x : 0) * w,
      dy: (h - dh) + (typeof f.y === 'number' ? f.y : 0) * h,
      dw: dw,
      dh: dh
    };
  }

  /** 纯函数：矩形 + 页面坐标 -> 归一化坐标（fitRect 的逆运算） */
  function normInRect(rect, px, py) {
    if (!rect || !rect.dw || !rect.dh) return null;
    return { nx: (px - rect.dx) / rect.dw, ny: (py - rect.dy) / rect.dh };
  }

  function SpriteRenderer(opts) {
    this.opts = opts || {};
    this.root = null;
    this.img = null;
    this.overlay = null;
    this.portraitId = null;
    this.hotspots = null;
    this._blinkTimer = null;
    this._hitCount = 0;
  }

  /**
   * 挂载到容器
   * @param {HTMLElement} host
   * @param {object} portrait {id, kind, src}
   * @param {object} cfg { fit:'contain'|'cover', onTouch(key, ev), editable, showOverlay }
   */
  SpriteRenderer.prototype.mount = function (host, portrait, cfg) {
    var o = cfg || {};
    this.teardown();
    this.portraitId = portrait ? portrait.id : null;
    this.hotspots = K.hotspotsOf(this.portraitId);

    var root = H.el('div', { class: 'hg-stage hg-rise' });
    root.style.cssText = 'position:absolute; inset:0; overflow:hidden;';
    this.root = root;

    // 立绘图片层
    var img = H.el('img', { class: 'hg-portrait-img', alt: '' });
    /**
     * 立绘定位（v1.5.33 重做，v1.5.38 改成显式像素几何）
     *
     * v1.5.33 的写法是 `inset:0 + object-fit:contain`，靠浏览器等比缩放居中 ——
     * 修好了"只露半边"，但**没法再做用户自定义的位移/缩放**（object-fit 和 transform 叠在一起
     * 会让命中测试的坐标换算变得很绕）。
     *
     * 现在直接算出「图片实际要画在哪」：contain 缩放 × 用户的 scale，底部对齐 +
     * 用户给的偏移。好处是图片元素的矩形**就等于**画面矩形，掩码命中换算变成一次除法。
     */
    var fit = K.portraitFit(portrait ? portrait.id : null);
    // 旧的 offsetX（逐立绘水平微调）折进 fit.x，保持向后兼容
    var ox = (portrait && typeof portrait.offsetX === 'number') ? portrait.offsetX : 0;
    this.fit = { x: fit.x + ox, y: fit.y, scale: fit.scale };
    this.offsetX = 0;   // 已经折进 fit，命中换算不再单独加

    img.style.cssText = 'position:absolute; left:0; top:0; width:0; height:0;'
      + 'user-select:none; -webkit-user-drag:none;'
      + 'filter:drop-shadow(0 18px 34px rgba(140,110,140,0.24));';
    if (portrait && portrait.src) img.src = portrait.src;
    // 立绘不存在时给一个优雅的剪影占位（不是破图）
    img.onerror = function () {
      img.style.display = 'none';
      root.insertBefore(Portraits.silhouette(), root.firstChild);
    };
    this.img = img;
    root.appendChild(img);

    // 热区层
    var overlay = H.el('div', { class: 'hg-hotspot-layer' });
    overlay.style.cssText = 'position:absolute; inset:0;';
    this.overlay = overlay;
    root.appendChild(overlay);
    if (o.showOverlay !== false) this.renderHotspots(o);

    host.appendChild(root);

    // 图片尺寸算完（或解码完）后布局一次；舞台尺寸变化时重新贴合
    var self2 = this;
    var relayout = function () { self2._layout(); };
    if (img.complete && img.naturalWidth) relayout();
    else img.onload = function () { relayout(); };
    setTimeout(relayout, 0);
    setTimeout(relayout, 120);
    this._relayout = relayout;
    try {
      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(relayout);
        this._ro.observe(root);
      } else {
        window.addEventListener('resize', relayout);
      }
    } catch (e) { window.addEventListener('resize', relayout); }
    return root;
  };

  /**
   * 按当前容器尺寸 + 用户调过的 fit 把图片摆到确切像素位置。
   * 图片元素的矩形 = 画面矩形，所以掩码命中换算只要一次除法。
   */
  SpriteRenderer.prototype._layout = function () {
    var img = this.img, root = this.root;
    if (!img || !root || img.style.display === 'none') return;
    var bw = root.clientWidth, bh = root.clientHeight;
    if (!bw || !bh) return;
    var nw = img.naturalWidth || 1024, nh = img.naturalHeight || 1536;
    var r = fitRect(bw, bh, nw, nh, this.fit);
    img.style.left = r.dx + 'px';
    img.style.top = r.dy + 'px';
    img.style.width = r.dw + 'px';
    img.style.height = r.dh + 'px';
    this._rect = r;
  };

  /** 渲染热区（可交互 / 可编辑两种形态） */
  SpriteRenderer.prototype.renderHotspots = function (cfg) {
    var o = cfg || this.opts || {};
    var self = this;
    var overlay = this.overlay;
    if (!overlay) return;
    overlay.innerHTML = '';
    var spots = this.hotspots || {};

    // v1.5.37：这套立绘涂过掩码 -> 用**整块可点层 + 掩码命中测试**，
    // 而不是一堆椭圆 DOM（涂抹出来的形状没法用 DOM 摆）。
    var maskKeys = (this.portraitId && K.maskKeys) ? K.maskKeys(this.portraitId) : [];
    if (!o.editable && maskKeys.length) {
      var tap = H.el('div', { class: 'hg-hotspot-tap' });
      tap.style.cssText = 'position:absolute; inset:0; cursor:pointer; touch-action:manipulation;';
      tap.onclick = function (ev) {
        ev.stopPropagation();
        var p = self._normFromEvent(ev);
        if (!p) return;
        var key = K.hitHotspot(self.portraitId, p.nx, p.ny);
        if (!key) return;
        var spot = null;
        for (var i = 0; i < C.HOTSPOTS.length; i++) if (C.HOTSPOTS[i].key === key) spot = C.HOTSPOTS[i];
        self._pulse(tap, ev, key);
        if (typeof o.onTouch === 'function') o.onTouch(key, ev, spot);
      };
      overlay.appendChild(tap);
      return;
    }

    C.HOTSPOTS.forEach(function (spot) {
      var g = spots[spot.key];
      if (!g) return;
      var d = H.el('div', {
        class: 'hg-touch' + (o.editable ? ' hg-touch-edit' : ''),
        'data-key': spot.key,
        title: o.editable ? (spot.name + '（拖动调整位置，滚轮/双指缩放）') : spot.hint
      });
      var w = (g.rx * 2 * 100), hh = (g.ry * 2 * 100);
      d.style.cssText = 'position:absolute; left:' + (g.x * 100) + '%; top:' + (g.y * 100) + '%;'
        + 'width:' + w + '%; height:' + hh + '%;'
        + 'transform:translate(-50%,-50%); border-radius:50%; cursor:pointer;'
        + 'background:' + (o.editable ? 'rgba(217,127,168,0.20)' : 'rgba(255,255,255,0.001)') + ';'
        + 'border:' + (o.editable ? '1.5px dashed rgba(217,127,168,0.85)' : 'none') + ';'
        + 'box-shadow:' + (o.editable && o.selectedKey === spot.key ? '0 0 0 3px rgba(217,127,168,0.35)' : 'none') + ';'
        + 'touch-action:none;';
      if (o.editable) {
        d.innerHTML = '<span style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);'
          + 'font-size:10px; font-weight:800; color:#8f5d78; background:rgba(255,255,255,0.86); padding:1px 6px;'
          + 'border-radius:8px; white-space:nowrap;">' + U.esc(spot.name) + '</span>';
        self._bindEdit(d, spot.key);
      } else {
        d.onclick = function (ev) {
          ev.stopPropagation();
          d.classList.add('hg-hit');
          setTimeout(function () { d.classList.remove('hg-hit'); }, 720);
          if (typeof o.onTouch === 'function') o.onTouch(spot.key, ev, spot);
        };
      }
      overlay.appendChild(d);
    });
  };

  /**
   * 把一次点击换算成「立绘画面内的归一化坐标」(0~1)。
   * v1.5.38 起图片元素本身就是画面矩形（见 _layout 的说明），
   * 所以这里只要把点击相对图片矩形做一次除法 —— 不管用户怎么挪、怎么放缩都准。
   */
  SpriteRenderer.prototype._normFromEvent = function (ev) {
    var img = this.img;
    if (!img || !img.getBoundingClientRect) return null;
    var box = img.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    var p = normInRect({ dx: box.left, dy: box.top, dw: box.width, dh: box.height }, ev.clientX, ev.clientY);
    if (!p) return null;
    if (p.nx < -0.02 || p.nx > 1.02 || p.ny < -0.02 || p.ny > 1.02) return null;
    return { nx: Math.min(1, Math.max(0, p.nx)), ny: Math.min(1, Math.max(0, p.ny)) };
  };

  /** 命中反馈：在点击处放一个扩散的光环 */
  SpriteRenderer.prototype._pulse = function (host, ev, key) {
    try {
      var box = host.getBoundingClientRect();
      var col = (HG.C.HOTSPOT_COLORS && HG.C.HOTSPOT_COLORS[key]) || '#D97FA8';
      var dot = H.el('div');
      dot.style.cssText = 'position:absolute; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%;'
        + 'pointer-events:none; left:' + (ev.clientX - box.left) + 'px; top:' + (ev.clientY - box.top) + 'px;'
        + 'background:radial-gradient(circle,' + col + '66 0%,' + col + '00 70%);'
        + 'border:1.5px solid ' + col + 'aa; animation:hg-pulse .72s ease-out;';
      host.appendChild(dot);
      setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 760);
    } catch (e) { }
  };

  /** 编辑模式：拖动 / 缩放热区 */
  SpriteRenderer.prototype._bindEdit = function (node, key) {    var self = this;
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    var rectOf = function () { return self.overlay.getBoundingClientRect(); };

    node.onpointerdown = function (ev) {
      ev.preventDefault();
      dragging = true;
      try { node.setPointerCapture(ev.pointerId); } catch (e) {}
      var r = rectOf();
      sx = ev.clientX; sy = ev.clientY;
      var g = self.hotspots[key];
      ox = g.x; oy = g.y;
      if (typeof self.opts.onSelect === 'function') self.opts.onSelect(key);
    };
    node.onpointermove = function (ev) {
      if (!dragging) return;
      ev.preventDefault();
      var r = rectOf();
      if (!r.width || !r.height) return;
      var nx = U.clamp(ox + (ev.clientX - sx) / r.width, 0, 1);
      var ny = U.clamp(oy + (ev.clientY - sy) / r.height, 0, 1);
      self.hotspots[key].x = nx;
      self.hotspots[key].y = ny;
      node.style.left = (nx * 100) + '%';
      node.style.top = (ny * 100) + '%';
    };
    var end = function (ev) {
      if (!dragging) return;
      dragging = false;
      try { node.releasePointerCapture(ev.pointerId); } catch (e) {}
      var g = self.hotspots[key];
      K.setHotspot(self.portraitId, key, g);
    };
    node.onpointerup = end;
    node.onpointercancel = end;

    // 滚轮缩放
    node.onwheel = function (ev) {
      ev.preventDefault();
      var g = self.hotspots[key];
      var f = ev.deltaY > 0 ? 0.94 : 1.06;
      g.rx = U.clamp(g.rx * f, 0.02, 0.6);
      g.ry = U.clamp(g.ry * f, 0.02, 0.6);
      node.style.width = (g.rx * 2 * 100) + '%';
      node.style.height = (g.ry * 2 * 100) + '%';
      K.setHotspot(self.portraitId, key, g);
    };
    // 双指缩放（触屏）
    var pinchStart = 0, pinchBase = 0;
    node.ontouchstart = function (ev) {
      if (ev.touches.length === 2) {
        pinchStart = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
        pinchBase = self.hotspots[key].rx;
      }
    };
    node.ontouchmove = function (ev) {
      if (ev.touches.length === 2 && pinchStart > 0) {
        ev.preventDefault();
        var d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
        var g = self.hotspots[key];
        var ratio = pinchBase * (d / pinchStart);
        g.rx = U.clamp(ratio, 0.02, 0.6);
        g.ry = U.clamp(ratio * 0.76, 0.02, 0.6);
        node.style.width = (g.rx * 2 * 100) + '%';
        node.style.height = (g.ry * 2 * 100) + '%';
      }
    };
    node.ontouchend = function () { pinchStart = 0; K.setHotspot(self.portraitId, key, self.hotspots[key]); };
  };

  /** 命中动画：物理反馈（呼吸加速 / 轻微摇晃 / 表情切换） */
  SpriteRenderer.prototype.react = function (key, expression) {
    if (!this.img) return;
    var img = this.img;
    img.classList.remove('hg-hit-react');
    // 强制重排以重启动画
    void img.offsetWidth;
    img.classList.add('hg-hit-react');
    setTimeout(function () { img.classList.remove('hg-hit-react'); }, 900);
    // 表情：用滤镜微调模拟（脸红 / 惊讶 / 移开视线）
    var filters = {
      blush: 'drop-shadow(0 18px 34px rgba(140,110,140,0.24)) saturate(1.16) brightness(1.03) hue-rotate(-6deg)',
      surprise: 'drop-shadow(0 18px 34px rgba(140,110,140,0.24)) brightness(1.06) contrast(1.04)',
      away: 'drop-shadow(0 18px 34px rgba(140,110,140,0.24)) saturate(0.94) brightness(0.99)',
      shy: 'drop-shadow(0 18px 34px rgba(140,110,140,0.24)) saturate(1.10) brightness(1.02)'
    };
    if (expression && filters[expression]) {
      img.style.filter = filters[expression];
      setTimeout(function () { img.style.filter = ''; }, 1400);
    }
    this._hitCount++;
  };

  SpriteRenderer.prototype.teardown = function () {
    if (this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; }
    try { if (this._ro) { this._ro.disconnect(); this._ro = null; } } catch (e) { }
    try { if (this._relayout) window.removeEventListener('resize', this._relayout); } catch (e) { }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null; this.img = null; this.overlay = null;
  };

  // ==========================================================================
  //  4. 主管理器 P
  // ==========================================================================

  var Portraits = {
    pool: new AssetPool(),
    renderer: null,
    live2d: null,
    _stage: null,

    live2dLoader: Live2DLoader,

    /** 静态立绘缺失时的剪影占位（不是 emoji，也不是破图） */
    silhouette: function () {
      var d = H.el('div');
      d.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;';
      d.innerHTML = '<svg viewBox="0 0 200 320" width="56%" height="82%" fill="none" stroke="rgba(217,127,168,0.42)"'
        + ' stroke-width="2.2" stroke-linecap="round">'
        + '<path d="M100 26c22 0 36 16 36 38 0 12-4 22-10 29 16 6 27 15 29 30l6 60" />'
        + '<path d="M100 26c-22 0-36 16-36 38 0 12 4 22 10 29-16 6-27 15-29 30l-6 60" />'
        + '<path d="M64 93c0 34 16 58 36 58s36-24 36-58" />'
        + '<path d="M62 186c-10 30-14 66-12 108h100c2-42-2-78-12-108" />'
        + '<circle cx="84" cy="66" r="3.4" fill="rgba(217,127,168,0.42)"/>'
        + '<circle cx="116" cy="66" r="3.4" fill="rgba(217,127,168,0.42)"/>'
        + '<path d="M92 84c4 3 12 3 16 0" />'
        + '</svg>'
        + '<div style="position:absolute; bottom:14%; font-size:11px; color:#c3b0c0; letter-spacing:.16em;">'
        + '尚未上传立绘</div>';
      return d;
    },

    /**
     * 内置默认立绘：开箱即用，避免新用户对着一个线稿占位小人。
     * 用户一旦自己上传/导入立绘，就完全以用户的为准（这里只是「没有立绘时」的兜底展示）。
     */
    BUILTIN_PORTRAIT: {
      id: 'builtin-hero', name: '默认立绘（可替换）', kind: 'image',
      src: 'images/heartgame/portrait/default.png',
      // offsetX 必须为 0：新版定位用 object-fit:contain + object-position，
      // 图片内容**本身就已经居中**了。曾经为「人物画得偏右」补过 -0.07，
      // 但在新定位下那是把已经居中的整幅图又左推 27px → 左边被切、右边留白，
      // 看起来就是「人跑到最左边、只露半边」。补偿随定位方式一起作废。
      offsetX: 0
    },

    /** 确保至少有一个可展示的立绘（不动用户数据，只在「一个都没有」时兜底） */
    ensureBuiltinPortrait: function () {
      var st = K.state;
      if (!st || !st.assets) return false;
      // 用户有自己的立绘 → 一律尊重用户
      if ((st.assets.portraits || []).length > 0) return false;
      var b = Portraits.BUILTIN_PORTRAIT;
      st.assets.portraits = [{
        id: b.id, name: b.name, kind: b.kind, src: b.src, modelUrl: '',
        offsetX: b.offsetX,
        tags: ['内置'], current: true, createdAt: Date.now()
      }];
      st.assets.currentPortraitId = b.id;
      st.assets.builtinPortrait = true;   // 标记为内置，便于用户立绘到位后自动让位
      K.save();
      return true;
    },

    /**
     * 内置场景背景（生成式插画，开箱即用）。
     * 用途分工（重要）：这些是**场景插画**，给 VN 剧情舞台与静室用；
     * **主页看板不用图**（看板已经有立绘 + 纯色氛围底，再铺场景图会喧宾夺主）。
     */
    BUILTIN_BACKGROUNDS: [
      { id: 'builtin-bg-night', name: '深夜房间', scene: '卧室', src: 'images/heartgame/stage/bg-night.png' },
      { id: 'builtin-bg-rain', name: '雨夜窗边', scene: '雨天', src: 'images/heartgame/stage/bg-rain.png' },
      { id: 'builtin-bg-dusk', name: '黄昏天台', scene: '黄昏', src: 'images/heartgame/stage/bg-dusk.png' }
    ],

    /** 把内置场景并入背景库（不动用户已上传的；只在缺失时补齐） */
    ensureBuiltinBackgrounds: function () {
      var st = K.state;
      if (!st || !st.assets) return false;
      st.assets.backgrounds = st.assets.backgrounds || [];
      var existing = {};
      st.assets.backgrounds.forEach(function (b) { existing[b.id] = 1; });
      var added = 0;
      Portraits.BUILTIN_BACKGROUNDS.forEach(function (b) {
        if (existing[b.id]) return;
        st.assets.backgrounds.push({
          id: b.id, name: b.name, scene: b.scene, src: b.src,
          tags: ['内置'], builtin: true, createdAt: Date.now()
        });
        added++;
      });
      if (added) K.save();
      return added > 0;
    },

    /**
     * 在看板容器里挂载立绘（Live2D 可用则 Live2D，否则静态 + 热区）
     * @param {HTMLElement} host
     * @param {object} cfg { onTouch, editable, onSelect, fit }
     * @returns {Promise<object>} { kind:'live2d'|'sprite', renderer }
     */
    mount: async function (host, cfg) {
      var o = cfg || {};
      Portraits.teardown();
      Portraits._stage = host;
      // 没有立绘时用内置默认立绘，而不是留一个线稿占位小人
      Portraits.ensureBuiltinPortrait();
      Portraits.ensureBuiltinBackgrounds();
      var portrait = K.currentPortrait();
      if (!portrait) {
        // 没有立绘：直接渲染剪影 + 默认热区，功能仍可用
        var shell = H.el('div');
        shell.style.cssText = 'position:absolute; inset:0;';
        shell.appendChild(Portraits.silhouette());
        var r0 = new SpriteRenderer(o);
        r0.portraitId = 'default';
        r0.hotspots = K.hotspotsOf('default');
        var layer = H.el('div');
        layer.style.cssText = 'position:absolute; inset:0;';
        r0.overlay = layer;
        shell.appendChild(layer);
        r0.root = shell;
        r0.renderHotspots(o);
        host.appendChild(shell);
        Portraits.renderer = r0;
        return { kind: 'sprite', renderer: r0, portrait: null };
      }

      // 资源池登记
      if (portrait.src) {
        Portraits.pool.acquire('portrait:' + portrait.id, { kind: 'image', url: portrait.src });
        K.touchAsset(HG.C.ASSET_PREFIX.portrait + portrait.id);
      }

      // Live2D 路径
      if (portrait.kind === 'live2d' && portrait.modelUrl) {
        var canvas = H.el('canvas');
        canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
        host.appendChild(canvas);
        var inst = await Live2DLoader.mount(canvas, portrait.modelUrl, host);
        if (inst) {
          Portraits.live2d = inst;
          // Live2D 的画面尺寸由引擎自己算，容器尺寸变化时让它重新贴合
          if (typeof inst.refit === 'function') { try { inst.refit(); } catch (e) { } }
          Portraits.pool.acquire('live2d:' + portrait.id, { kind: 'live2d', url: portrait.modelUrl, instance: inst });
          // Live2D 也要能戳：叠一层热区
          var rl = new SpriteRenderer(o);
          rl.portraitId = portrait.id;
          rl.hotspots = K.hotspotsOf(portrait.id);
          var ovl = H.el('div');
          ovl.style.cssText = 'position:absolute; inset:0;';
          rl.overlay = ovl;
          rl.root = ovl;
          host.appendChild(ovl);
          rl.renderHotspots(o);
          Portraits.renderer = rl;
          return { kind: 'live2d', renderer: rl, portrait: portrait };
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }

      // 静态立绘路径
      var r = new SpriteRenderer(o);
      r.mount(host, portrait, o);
      Portraits.renderer = r;
      return { kind: 'sprite', renderer: r, portrait: portrait };
    },

    /**
     * 触控反应：**优先交给模型生成**（暧昧/细腻的地方必须是 AI 现写，而不是背预设），
     * 生成不可用时才回落到动作库 / 内置分部位文案库。
     * 生成成功的结果会顺手写进动作库，作为该部位该阶段的「已解锁台词」沉淀下来。
     */
    react: async function (key, ctx) {
      var o = ctx || {};
      var portraitId = (K.currentPortrait() || {}).id || 'default';
      var profile = await K.charProfile();
      var tier = K.tier();
      var reverse = K.isReverse();
      var tierIdx = K.tierIndex();

      // ① 首选：让模型基于角色设定 + 当前阶梯现写一句
      //    （戳戳是高频交互，缓存命中同一阶梯时直接复用，避免每次都打接口）
      var cacheKey = portraitId + '|' + key + '|' + tier.key + '|' + (o.mood || K.state.quiet.mood);
      var cached = Portraits._reactCache[cacheKey];
      if (cached && Date.now() - cached.at < 3 * 60 * 1000) {
        return { text: cached.text, source: 'cache', expression: cached.expression || 'blush' };
      }

      var spot = C.HOTSPOTS.filter(function (s) { return s.key === key; })[0] || { name: '身体', hint: '碰了一下' };
      var mood = K.moodOf(o.mood || K.state.quiet.mood);
      var prompt = '你正在扮演「' + profile.name + '」。\n'
        + '角色设定：' + U.cut(profile.persona || '（未填写，按名字气质自行发挥）', 420) + '\n'
        + '当前关系阶段：' + tier.name + '（第 ' + (tierIdx + 1) + '/6 阶）\n'
        + '当前身份：' + (reverse ? 'TA 是被你攻略的看板角色，你是疯狂心动的玩家' : '你是被攻略的一方，TA 是玩家') + '\n'
        + '此刻心情：' + mood.name + '\n'
        + '事件：玩家在看板上碰了你的「' + spot.name + '」。\n\n'
        // ★ 用户定义（2026-09-12）：
        // 「触碰的反应不应该是动作描写，而是更口语化的 —— 定义就是 user 碰了碰/摸了摸你的哪里，
        //   所以应该是**说的话**而不是反应。」
        + '请用**你开口说的那句话**来回应 —— 一句 12~30 字的口语台词。\n'
        + '要求：\n'
        + '· 必须是**说出口的话**，不要写动作、不要写神态、不要写旁白（不许出现"TA 一怔""睫毛颤了颤"这类）。\n'
        + '· 口语化，像真人当场脱口而出；允许短句、反问、半截话、语气词。\n'
        + '· 要能听出“刚才有人碰了你这里”这件事，但**不要复述被碰的部位**（别说"你摸我脸干什么"这种）。\n'
        + '· 分寸符合当前阶段：相识阶段会避开或轻描淡写，眷恋之后可以不掩饰、甚至反将一军。\n'
        + '· 直接给这句话本身，不要引号、不要写你的名字、不要解释。';
      var out = await K.ask(prompt, { temperature: 0.95 });
      if (out) {
        var clean = String(out).replace(/^["「『]|["」』]$/g, '').replace(/\n+/g, ' ').trim();
        if (clean) {
          Portraits._reactCache[cacheKey] = { text: clean, at: Date.now(), expression: 'blush' };
          // 沉淀成该部位该阶段的专属台词（下次即使离线也能用上）
          K.pushHotspotAction(portraitId, key, { text: clean, tier: tier.key });
          return { text: clean, source: 'llm', expression: 'blush' };
        }
      }

      // ② 回落：已解锁的动作库（同部位、同阶梯或更早的）
      var lib = K.hotspotActionsOf(portraitId, key);
      var usable = lib.filter(function (a) {
        return K.tierIndex(a.tier || 'acquaint') <= tierIdx;
      });
      if (usable.length) {
        var pick = usable[Math.floor(Math.random() * usable.length)];
        return { text: pick.text, source: 'library', expression: 'blush' };
      }

      // ③ 最后兜底：内置分部位 × 分阶梯反应库（保证没 API 也有反馈）
      return { text: Portraits.fallbackLine(key, tierIdx, profile.name), source: 'fallback', expression: 'shy' };
    },

    /** 戳戳反应的短时缓存（同一阶梯同一部位 3 分钟内复用，省接口也更稳） */
    _reactCache: {},

    /**
     * 内置台词库：14 部位 × 6 阶梯分档（模型不可用时的兜底）
     * ★ v1.5.48：全部改成**说出口的话**。用户定义（2026-09-12）：
     *   「触碰的反应不应该是动作描写，而是更口语化的 —— 定义就是 user 碰了碰/摸了摸你的哪里，
     *     所以应该是**说的话**而不是反应。」
     */
    fallbackLine: function (key, tierIdx, name) {
      var L = {
        head: [
          '……有事？',
          '摸够了没。',
          '别摸乱了。',
          '……再摸一会儿也行。',
          '嗯。手别拿开。',
          '你摸的时候，我什么都不想干。'
        ],
        eye: [
          '看什么。',
          '别盯着。',
          '……你靠太近了。',
          '看吧，反正躲不掉。',
          '你再这样看我，我会当真的。',
          '看清楚了吗，里面就你一个。'
        ],
        mouth: [
          '干嘛。',
          '别闹。',
          '……离远点。',
          '手放这儿，是想让我说话还是不想让我说。',
          '碰一下就算完事了？',
          '要碰就碰，别试探我。'
        ],
        shoulder: [
          '怎么了。',
          '有事说事。',
          '……可以，就一会儿。',
          '靠着吧。',
          '再近一点也没关系。',
          '没人看见的时候，你想怎样都行。'
        ],
        heart: [
          '你干什么。',
          '别乱按。',
          '……跳得有点快，你别听。',
          '数清楚了吗。',
          '它早就不听我的了。',
          '从你出现那天起，它就一直这样。'
        ],
        waist: [
          '手拿开。',
          '别碰那儿。',
          '……痒。',
          '你手往哪儿放呢。',
          '别在这儿……好吧，就一下。',
          '抱紧点，别松。'
        ],
        forearm: [
          '有事？',
          '松手。',
          '……行吧。',
          '你抓着我干嘛。',
          '抓着就抓着，别放开。',
          '反正我也不打算走。'
        ],
        hair: [
          '别动我头发。',
          '干嘛突然摸头。',
          '乱就乱吧。',
          '……轻一点。',
          '再摸一会儿也不是不行。',
          '你摸过的地方，我一直留着。'
        ],
        face: [
          '你干嘛。',
          '别碰脸。',
          '……手凉。',
          '你手怎么这么烫。',
          '别停。',
          '就当我贪心，再摸一会儿。'
        ],
        neck: [
          '别碰那儿。',
          '……手别乱放。',
          '痒。',
          '你故意的吧。',
          '这里别人碰我会躲。',
          '这里只有你能碰，记住了。'
        ],
        chest: [
          '你干什么。',
          '别贴这么近。',
          '……退一点。',
          '听清楚了吗。',
          '心跳都被你听去了。',
          '它一直这样，从你开始出现的那天起。'
        ],
        arm: [
          '怎么了。',
          '松开。',
          '……随你。',
          '拉着我干嘛。',
          '拉着就拉着吧。',
          '拉着吧，反正我也不打算走。'
        ],
        hand: [
          '干嘛。',
          '别抓这么紧。',
          '……手有点凉。',
          '你手怎么在抖。',
          '这样扣着挺好。',
          '这样扣着，以后谁都不许先松。'
        ],
        leg: [
          '别碰。',
          '挪开点。',
          '……腿别靠过来。',
          '你故意的吧。',
          '就这样待一会儿。',
          '别动，就保持这样。'
        ]
      };
      var arr = L[key] || L.hand;
      var i = U.clamp(Math.round((tierIdx / 5) * (arr.length - 1)), 0, arr.length - 1);
      return arr[i];
    },

    /**
     * 抠出一层热区掩码（SVG 路径），供后台管理里叠加显示 / 导出
     * @returns {string} svg 元素 HTML
     */
    maskSvg: function (portraitId, opts) {
      var o = opts || {};
      var spots = K.hotspotsOf(portraitId);
      var paths = C.HOTSPOTS.map(function (s) {
        var g = spots[s.key];
        if (!g) return '';
        var d = H.SHAPES.ellipse(g.x * 100, g.y * 100, g.rx * 100, g.ry * 100);
        return '<path d="' + d + '" fill="' + (o.fill || 'rgba(217,127,168,0.24)') + '"'
          + ' stroke="' + (o.stroke || 'rgba(217,127,168,0.75)') + '" stroke-width="0.6" data-key="' + s.key + '"/>';
      }).join('');
      return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%;'
        + 'height:100%; pointer-events:none;">' + paths + '</svg>';
    },

    // ------------------------------------------------------------------
    //  4.1 立绘管理面板（多立绘轮换 / 上传 / Live2D 模型）
    // ------------------------------------------------------------------

    openManager: function (onChanged) {
      var body = H.el('div');

      function refresh() {
        body.innerHTML = '';
        var cur = K.state.assets.portraits;
        if (!cur.length) {
          body.appendChild(H.empty('还没有上传立绘。上传一张高清立绘，或绑定 Live2D 模型包。', { icon: 'portrait' }));
        }
        cur.forEach(function (p) {
          var isCur = K.state.assets.currentPortraitId === p.id;
          var row = H.listRow({
            icon: p.kind === 'live2d' ? 'sparkle' : 'portrait',
            color: isCur ? '#D97FA8' : '#9FB3D9',
            soft: isCur ? '#FFEBF3' : '#EDF2FB',
            title: p.name,
            subtitle: (p.kind === 'live2d' ? 'Live2D 模型包' : '静态立绘') + ' · ' + (p.tags && p.tags.length ? p.tags.join(' / ') : '未标注'),
            subtitleWrap: true,
            rightNode: (function () {
              var box = H.el('div');
              box.style.cssText = 'display:flex; align-items:center; gap:6px; flex-shrink:0;';
              if (isCur) box.appendChild(H.chip('主页展示', { color: '#D97FA8', soft: '#FFEBF3' }));
              else {
                var setB = H.button('设为当前', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#FFEBF3', color: '#B0728F' });
                setB.onclick = function (ev) {
                  ev.stopPropagation();
                  K.setCurrentPortrait(p.id);
                  H.toast('已设为当前主页展示');
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                };
                box.appendChild(setB);
              }
              // ★ 热区涂抹入口：**每一套立绘**都有（v1.5.37）
              var mk = K.maskKeys(p.id).length;
              var hotB = H.button(mk ? ('热区 ' + mk) : '划热区', {
                kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#F3EEFF', color: '#7d63a8'
              });
              hotB.onclick = function (ev) {
                ev.stopPropagation();
                Portraits.openMaskEditor(onChanged, p.id);
              };
              box.appendChild(hotB);
              var del = H.iconButton('trash', { size: 28, color: '#c2607c' });
              del.onclick = function (ev) {
                ev.stopPropagation();
                H.confirm({
                  title: '删除立绘', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
                  message: '确定删除「' + p.name + '」吗？该立绘的热区划分与动作库也会一并清除。',
                  okText: '删除'
                }).then(function (ok) {
                  if (!ok) return;
                  K.removePortrait(p.id);
                  H.toast('已删除');
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                });
              };
              box.appendChild(del);
              return box;
            })()
          });
          row.onclick = null;
          body.appendChild(row);
        });

        // Live2D 运行时配置
        body.appendChild(H.sectionTitle('Live2D 运行时', { color: '#B79EDC' }));
        body.appendChild((function () {
          var r = H.el('div');
          r.style.cssText = 'background:rgba(255,255,255,0.7); border:1px solid rgba(183,158,220,0.25);'
            + 'border-radius:14px; padding:11px 12px; margin-bottom:10px;';

          var intro = H.el('div');
          intro.style.cssText = 'font-size:11px; line-height:1.72; color:#8b8292;';
          intro.innerHTML = '项目不内置 Cubism 运行时（体积与授权原因），但可以一键配上。<br>'
            + '需要 <b>3 个</b>脚本、顺序不能换：<b>Cubism4 Core</b> → <b>PIXI</b> → <b>pixi-live2d-display</b>。<br>'
            + '<span style="color:#c2607c;">注意：网上常见的 live2d-widget 的 live2d.min.js 是 Cubism&nbsp;2 内核，'
            + '只能读老式 .moc，读不了 .moc3，会导致"检测成功但永远没有立绘"。</span>';
          r.appendChild(intro);

          var ta = H.el('textarea', { rows: 4, placeholder: '每行一个地址（按顺序加载）' });
          ta.value = Live2DLoader.scripts().join('\n');
          ta.style.cssText = 'width:100%; box-sizing:border-box; margin-top:9px; border-radius:11px;'
            + 'border:1px solid rgba(183,158,220,0.35); padding:8px 10px; font-size:11px; color:#5c4450;'
            + 'background:#fff; outline:none; font-family:ui-monospace,Menlo,Consolas,monospace; line-height:1.6;'
            + 'resize:vertical;';
          r.appendChild(ta);

          // 当前状态：到底能不能用、缺什么，直接写在面板上
          var status = H.el('div');
          status.style.cssText = 'margin-top:9px; font-size:10.6px; line-height:1.7; color:#7d7484;'
            + 'background:rgba(243,238,255,0.7); border-radius:11px; padding:8px 10px;';
          var renderStatus = function () {
            var d = Live2DLoader.diagnose();
            var label = d.runtime === 'cubism4' ? 'Cubism4 运行时已就绪（可驱动 .moc3）'
              : d.runtime === 'cubism2' ? '只检测到 Cubism2 内核（只能读 .moc，读不了 .moc3）'
                : '运行时未就绪';
            status.innerHTML = '<b>当前状态：</b>' + label + '<br>'
              + 'WebGL：' + (d.webgl ? '可用' : '不可用') + ' · '
              + 'Cubism4 Core：' + (d.hasCubismCore ? '已加载' : '无') + ' · '
              + 'PIXI：' + (d.hasPixi ? '已加载' : '无') + ' · '
              + 'pixi-live2d：' + (d.hasPixiLive2d ? '已加载' : '无');
            if (d.error) {
              var errEl = H.el('div');
              errEl.style.cssText = 'color:#c2607c; margin-top:4px; word-break:break-all;';
              errEl.textContent = '最近错误：' + d.error;
              status.appendChild(errEl);
            }
          };
          renderStatus();
          r.appendChild(status);

          var bar = H.el('div');
          bar.style.cssText = 'display:flex; gap:8px; margin-top:9px; flex-wrap:wrap;';
          var presetB = H.button('使用推荐运行时', { kind: 'primary', block: true, icon: 'sparkle' });
          presetB.onclick = function () {
            Live2DLoader.usePreset();
            ta.value = Live2DLoader.scripts().join('\n');
            H.toast('已填入推荐运行时，正在加载…');
            Live2DLoader.ensure().then(function (ok) {
              renderStatus();
              H.toast(ok ? '运行时已就绪，回到看板即可看到模型' : '运行时没加载成功，请检查网络');
              refresh();
            });
          };
          var saveB = H.button('保存地址', { kind: 'soft', block: true, soft: '#F3EEFF', color: '#7d63a8' });
          saveB.onclick = function () {
            Live2DLoader.setScripts(ta.value.split('\n'));
            H.toast(Live2DLoader.scripts().length ? '已保存 ' + Live2DLoader.scripts().length + ' 个地址' : '已清空');
            renderStatus();
          };
          var testB = H.button('检测', { kind: 'outline', color: '#7d63a8', border: 'rgba(183,158,220,0.5)', pad: '9px 14px' });
          testB.onclick = async function () {
            testB.textContent = '检测中…';
            if (ta.value.trim() !== Live2DLoader.scripts().join('\n')) Live2DLoader.setScripts(ta.value.split('\n'));
            await Live2DLoader.ensure();
            testB.textContent = '检测';
            renderStatus();
            var d = Live2DLoader.diagnose();
            H.modal({
              title: d.runtime === 'cubism4' ? '运行时可用' : '运行时还不可用',
              icon: d.runtime === 'cubism4' ? 'check' : 'info',
              accent: d.runtime === 'cubism4' ? '#7d63a8' : '#9FB3D9',
              message: d.runtime === 'cubism4'
                ? '已检测到 Cubism4 运行时，.moc3 模型现在可以驱动了。回到看板即可看到。'
                : (d.runtime === 'cubism2'
                  ? '只检测到 Cubism2 内核。它读不了 .moc3 模型 —— 请点「使用推荐运行时」换成 Cubism4。'
                  : '还没检测到可用运行时。\nWebGL：' + (d.webgl ? '可用' : '不可用')
                  + '\nCubism4 Core：' + (d.hasCubismCore ? '已加载' : '无')
                  + '\nPIXI：' + (d.hasPixi ? '已加载' : '无')
                  + '\npixi-live2d：' + (d.hasPixiLive2d ? '已加载' : '无')
                  + (d.error ? '\n\n错误：' + d.error : ''))
            });
          };
          bar.appendChild(presetB);
          bar.appendChild(saveB);
          bar.appendChild(testB);
          r.appendChild(bar);
          return r;
        })());

        // 当前立绘没驱动起来的原因，也直接写在这里，省得用户去猜
        (function () {
          var cur = K.currentPortrait();
          if (!cur || cur.kind !== 'live2d') return;
          var d = Live2DLoader.diagnose();
          if (d.runtime === 'cubism4') return;
          var warn = H.el('div');
          warn.style.cssText = 'font-size:10.8px; line-height:1.72; color:#B0728F; background:rgba(255,241,247,0.9);'
            + 'border:1px solid rgba(217,127,168,0.3); border-radius:13px; padding:10px 12px; margin-bottom:10px;';
          warn.innerHTML = '当前立绘「' + cur.name + '」是 Live2D 模型，但运行时还没配好，'
            + '所以看板上看不到它。点上面的「使用推荐运行时」，然后回到看板即可。';
          body.insertBefore(warn, body.firstChild);
        })();

        if (typeof onChanged === 'function') { /* 由调用方决定何时重绘 */ }
      }

      refresh();

      H.sheet({
        title: '立绘管理',
        subtitle: '多套服装 / 形态轮换 · Live2D 与静态立绘混用',
        icon: 'portrait',
        height: '88%',
        slot: 'portrait-manager',
        content: body,
        buttons: [
          {
            text: '上传静态立绘', icon: 'upload', kind: 'soft', soft: '#FFEBF3', color: '#B0728F',
            keepOpen: true,
            onClick: function () {
              Portraits.pickImage(1400, function (dataUrl) {
                H.prompt({
                  title: '立绘名称', placeholder: '例如：雨夜 · 白衬衫', value: '新立绘'
                }).then(function (name) {
                  if (name === null) return;
                  K.addPortrait({ name: name || '新立绘', kind: 'image', src: dataUrl });
                  H.toast('立绘已上传');
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                });
              });
            }
          },
          {
            text: '导入模型包 (zip)', icon: 'upload', kind: 'primary', keepOpen: true,
            onClick: function () {
              Portraits.pickZip(async function (file) {
                var sheetBody = H.el('div');
                var stage = H.el('div');
                stage.style.cssText = 'font-size:11.4px; color:#8d8397; line-height:1.9; text-align:center; padding:18px 8px;';
                sheetBody.appendChild(stage);
                var sheetPromise = H.sheet({
                  title: '正在导入模型包',
                  subtitle: file.name,
                  icon: 'sparkle',
                  height: '46%',
                  content: sheetBody,
                  dismissible: false
                });
                var step = function (s, d) { stage.textContent = d || s; };
                try {
                  var parsed = await ZipModel.parse(file, step);
                  // 记录到资源池，页面销毁时统一释放 blob URL
                  Portraits._zipRecords = Portraits._zipRecords || [];
                  Portraits._zipRecords.push(parsed);
                  Portraits.pool.acquire('zip:' + parsed.jsonPath, { kind: 'image', url: parsed.entryUrl });

                  var created = K.addPortrait({
                    name: parsed.name || 'Live2D 模型',
                    kind: 'live2d',
                    modelUrl: parsed.entryUrl,
                    // 注意：src 不存 blob URL —— 那是本次会话的临时地址，
                    // 重启后必然失效；留空让 Live2D 分支自己渲染，失败则回落剪影。
                    src: '',
                    tags: (parsed.mocFound ? [] : ['仅贴图']).concat(['zip 导入'])
                  });
                  H.closeAllLayers();
                  H.toast('模型包已导入（' + parsed.fileCount + ' 个文件）');
                  if (parsed.synthesized) {
                    H.toast('包里没有 model3.json，已按包内文件自动生成');
                  }
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                  // 导入即尝试驱动一次，能跑起来就直接看到效果；跑不起来要说**具体原因**，
                  // 并在包里有图时兜底成一张静态立绘（用户要求：包不对就提示 + 拿一张图兜底）
                  if (parsed.entryUrl) {
                    setTimeout(function () {
                      var cv = document.createElement('canvas');
                      Live2DLoader.mount(cv, parsed.entryUrl, null).then(function (inst) {
                        if (inst) return;
                        Portraits._reportLive2DFailure(parsed, created);
                      });
                    }, 300);
                  }
                } catch (err) {
                  H.closeAllLayers();
                  Portraits._offerImageFallback(file, (err && err.message) ? err.message : String(err),
                    typeof onChanged === 'function' ? onChanged : null);
                }
              });
            }
          },
          {
            text: '绑定模型地址', icon: 'sparkle', kind: 'outline',
            color: '#7d63a8', border: 'rgba(183,158,220,0.5)',
            keepOpen: true,
            onClick: function () {
              H.prompt({
                title: 'Live2D 模型地址',
                message: '填入 model3.json（或模型包内入口文件）的地址。运行时未配置时会自动回落静态立绘。',
                placeholder: 'https://…/model3.json'
              }).then(function (url) {
                if (!url) return;
                H.prompt({ title: '模型名称', value: 'Live2D 模型' }).then(function (name) {
                  K.addPortrait({ name: name || 'Live2D 模型', kind: 'live2d', modelUrl: url, src: '' });
                  H.toast('模型已绑定');
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                });
              });
            }
          }
        ]
      });
    },

    // ------------------------------------------------------------------
    //  4.2 热区涂抹划分系统（v1.5.37 重做：真的是"涂"出来的）
    //     · 所有立绘都能进（立绘管理每一行都有入口）
    //     · 缩放 / 平移画面
    //     · 画笔 + 橡皮擦 + 笔刷大小
    //     · 每个部位一张 80×120 的 1 位掩码，可留空
    // ------------------------------------------------------------------

    openMaskEditor: function (onChanged, portraitId) {
      var MW = K.MASK_W, MH = K.MASK_H;
      var all = (K.state && K.state.assets && K.state.assets.portraits) || [];
      var pid = portraitId || (K.currentPortrait() || {}).id || 'default';
      var portrait = all.filter(function (p) { return p.id === pid; })[0] || null;

      // 内存里的掩码（key -> Uint8Array），保存时才落库
      var masks = {};
      C.HOTSPOTS.forEach(function (s) {
        var m = K.maskOf(pid, s.key);
        if (m) masks[s.key] = m;
      });
      var active = C.HOTSPOTS[0].key;
      var brush = 5;
      var erase = false;
      var zoom = 1, panX = 0, panY = 0;
      var undo = [];

      var body = H.el('div');

      // ---------- 顶部：缩放 / 平移 ----------
      var topBar = H.el('div');
      topBar.style.cssText = 'display:flex; align-items:center; gap:7px; margin-bottom:9px; flex-wrap:wrap;';
      var zoomLabel = H.el('span');
      zoomLabel.style.cssText = 'font-size:11px; font-weight:800; color:#7d7484; min-width:46px; text-align:center;';
      var mkBtn = function (txt, fn, title) {
        var b = H.el('button', { type: 'button', title: title || txt });
        b.style.cssText = 'padding:6px 11px; border-radius:11px; font-size:11.5px; font-weight:800; cursor:pointer;'
          + 'border:1px solid rgba(190,180,195,0.3); background:rgba(255,255,255,0.85); color:#7d7484;';
        b.textContent = txt;
        b.onclick = fn;
        return b;
      };
      var setZoom = function (z) { zoom = U.clamp(z, 0.5, 6); applyTransform(); };
      topBar.appendChild(mkBtn('－', function () { setZoom(zoom / 1.25); }, '缩小'));
      topBar.appendChild(zoomLabel);
      topBar.appendChild(mkBtn('＋', function () { setZoom(zoom * 1.25); }, '放大'));
      topBar.appendChild(mkBtn('1:1', function () { zoom = 1; panX = 0; panY = 0; applyTransform(); }, '复位'));
      var hint = H.el('span');
      hint.style.cssText = 'font-size:10px; color:#a99fae; margin-left:auto;';
      hint.textContent = '双指缩放 / 拖动空白处平移';
      topBar.appendChild(hint);
      body.appendChild(topBar);

      // ---------- 舞台 ----------
      var stage = H.el('div');
      stage.style.cssText = 'position:relative; width:100%; height:330px; border-radius:18px; overflow:hidden;'
        + 'background:linear-gradient(160deg,#FDF7FB 0%,#F1EEF9 100%); border:1px solid rgba(216,160,190,0.24);'
        + 'touch-action:none;';
      body.appendChild(stage);

      var wrapper = H.el('div');
      wrapper.style.cssText = 'position:absolute; inset:0; transform-origin:50% 50%;';
      stage.appendChild(wrapper);

      var img = H.el('img', { alt: '' });
      img.style.cssText = 'position:absolute; left:0; top:0; width:0; height:0;'
        + 'user-select:none; -webkit-user-drag:none; pointer-events:none;';
      if (portrait && portrait.src) img.src = portrait.src;
      wrapper.appendChild(img);

      // 模型立绘没有静态图：给一个提示底，掩码同样按归一化坐标工作
      var noImg = H.el('div');
      noImg.style.cssText = 'position:absolute; inset:0; display:none; align-items:center; justify-content:center;'
        + 'font-size:11px; color:#a99fae; text-align:center; line-height:1.8; pointer-events:none;';
      noImg.textContent = '这套立绘是 Live2D 模型，没有静态图可参考。\n' +
        '掩码按「画面比例」记录，照着模型大致位置涂即可。';
      wrapper.appendChild(noImg);

      var cv = H.el('canvas', { width: MW, height: MH });
      cv.style.cssText = 'position:absolute; image-rendering:pixelated; cursor:crosshair; touch-action:none;'
        + 'border-radius:6px;';
      wrapper.appendChild(cv);
      var ctx = cv.getContext('2d');

      // 现有椭圆版式叠加显示（对照用）：位置与画布完全重合，所以百分比直接就是"立绘坐标"
      var spotLayer = H.el('div');
      spotLayer.style.cssText = 'position:absolute; pointer-events:none;';
      wrapper.appendChild(spotLayer);

      function drawSpots() {
        spotLayer.innerHTML = '';
        var saved = K.hotspotsOf(pid);
        C.HOTSPOTS.forEach(function (s) {
          if (masks[s.key]) return;              // 涂过的部位不再显示椭圆
          var g = saved[s.key];
          if (!g) return;
          var d = H.el('div');
          d.style.cssText = 'position:absolute; left:' + (g.x * 100) + '%; top:' + (g.y * 100) + '%;'
            + 'width:' + (g.rx * 200) + '%; height:' + (g.ry * 200) + '%; transform:translate(-50%,-50%);'
            + 'border:1px dashed ' + (C.HOTSPOT_COLORS[s.key] || '#D97FA8') + '99; border-radius:50%;'
            + 'display:flex; align-items:center; justify-content:center;';
          d.innerHTML = '<span style="font-size:8px; color:#7d7484; background:rgba(255,255,255,0.8);'
            + 'padding:0 3px; border-radius:6px; white-space:nowrap;">' + U.esc(s.name) + '</span>';
          spotLayer.appendChild(d);
        });
      }

      function applyTransform() {
        wrapper.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
        zoomLabel.textContent = U.round(zoom * 100, 0) + '%';
      }

      /**
       * 把立绘与 canvas 一起对齐到「图片实际画出来的区域」。
       * v1.5.40：改用**这套立绘自己的 fit**（和主界面同一套参数），
       * 所以掩码是**绑定在立绘上**的 —— 立绘挪到哪、放多大，热区都跟着走。
       */
      function layoutCanvas() {
        var bw = stage.clientWidth, bh = stage.clientHeight;
        var hasImg = !!(portrait && portrait.src) && !!img.naturalWidth;
        noImg.style.display = hasImg ? 'none' : 'flex';
        var r = fitRect(bw, bh, hasImg ? img.naturalWidth : 2, hasImg ? img.naturalHeight : 3,
          K.portraitFit(pid));
        if (hasImg) {
          img.style.left = r.dx + 'px';
          img.style.top = r.dy + 'px';
          img.style.width = r.dw + 'px';
          img.style.height = r.dh + 'px';
        }
        [cv, spotLayer].forEach(function (el) {
          el.style.left = r.dx + 'px';
          el.style.top = r.dy + 'px';
          el.style.width = r.dw + 'px';
          el.style.height = r.dh + 'px';
        });
      }

      function drawMask() {
        ctx.clearRect(0, 0, MW, MH);
        C.HOTSPOTS.forEach(function (s) {
          var m = masks[s.key];
          if (!m) return;
          var col = C.HOTSPOT_COLORS[s.key] || '#D97FA8';
          ctx.fillStyle = col;
          ctx.globalAlpha = (s.key === active) ? 0.62 : 0.26;
          for (var y = 0; y < MH; y++) {
            for (var x = 0; x < MW; x++) {
              if (m[y * MW + x]) ctx.fillRect(x, y, 1, 1);
            }
          }
        });
        ctx.globalAlpha = 1;
        drawSpots();
      }

      function paintAt(gx, gy) {
        var m = masks[active];
        if (!m) { m = masks[active] = new Uint8Array(MW * MH); }
        var r = brush;
        for (var y = Math.max(0, Math.floor(gy - r)); y <= Math.min(MH - 1, Math.ceil(gy + r)); y++) {
          for (var x = Math.max(0, Math.floor(gx - r)); x <= Math.min(MW - 1, Math.ceil(gx + r)); x++) {
            var dx = x - gx, dy = y - gy;
            if (dx * dx + dy * dy <= r * r) m[y * MW + x] = erase ? 0 : 1;
          }
        }
      }

      function emptyOf(bytes) {
        if (!bytes) return true;
        for (var i = 0; i < bytes.length; i++) if (bytes[i]) return false;
        return true;
      }

      // ---------- 指针交互：画笔 / 橡皮擦 / 平移 ----------
      var painting = false, panning = false, pinching = false, moved = false;
      var lastPan = null;

      cv.onpointerdown = function (ev) {
        ev.preventDefault();
        // 合成事件下 pointerId 不是"活动指针"，setPointerCapture 会抛 NotFoundError
        try { cv.setPointerCapture && cv.setPointerCapture(ev.pointerId); } catch (e) { }
        undo.push(masks[active] ? masks[active].slice() : null);
        if (undo.length > 24) undo.shift();
        painting = true; moved = false;
        strokeAt(ev);
      };
      cv.onpointermove = function (ev) {
        if (!painting) return;
        ev.preventDefault();
        moved = true;
        strokeAt(ev);
      };
      var endStroke = function () {
        if (!painting) return;
        painting = false;
        if (!moved && !erase) {
          // 点一下也算一笔：保持行为一致，不做特殊处理
        }
        drawMask();
        renderChips();
      };
      cv.onpointerup = endStroke;
      cv.onpointercancel = endStroke;
      cv.onpointerleave = function () { if (painting) endStroke(); };

      function strokeAt(ev) {
        var r = cv.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var gx = (ev.clientX - r.left) / r.width * MW;
        var gy = (ev.clientY - r.top) / r.height * MH;
        paintAt(gx, gy);
        drawMask();
      }

      // 空白处拖动 = 平移（指针事件覆盖鼠标与触屏）
      stage.onpointerdown = function (ev) {
        if (ev.target === cv) return;
        panning = true; lastPan = { x: ev.clientX, y: ev.clientY };
        try { stage.setPointerCapture && stage.setPointerCapture(ev.pointerId); } catch (e) { }
      };
      stage.onpointermove = function (ev) {
        if (!panning || pinch) return;
        ev.preventDefault();
        panX += ev.clientX - lastPan.x;
        panY += ev.clientY - lastPan.y;
        lastPan = { x: ev.clientX, y: ev.clientY };
        applyTransform();
      };
      var stopPan = function () { panning = false; };
      stage.onpointerup = stopPan;
      stage.onpointercancel = stopPan;
      stage.onpointerleave = stopPan;

      // 双指缩放（v1.5.40：用户反馈"双指缩放与空白区域移动没做出来"）
      var pinch = null;
      var touchDist = function (t) {
        var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
        return Math.hypot(dx, dy) || 1;
      };
      stage.addEventListener('touchstart', function (ev) {
        if (ev.touches.length === 2) {
          ev.preventDefault();
          pinching = true;
          pinch = { d: touchDist(ev.touches), zoom: zoom, px: panX, py: panY };
        }
      }, { passive: false });
      stage.addEventListener('touchmove', function (ev) {
        if (ev.touches.length === 2 && pinch) {
          ev.preventDefault();
          // 双指既是缩放也是平移（中点位移），和相册的手感一致
          var d = touchDist(ev.touches);
          var k = d / pinch.d;
          zoom = U.clamp(pinch.zoom * k, 0.5, 6);
          applyTransform();
        }
      }, { passive: false });
      var endPinch = function () { pinch = null; pinching = false; };
      stage.addEventListener('touchend', endPinch);
      stage.addEventListener('touchcancel', endPinch);

      // 滚轮缩放（桌面端）
      stage.onwheel = function (ev) {
        ev.preventDefault();
        setZoom(zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
      };

      // ---------- 部位选择 ----------
      var chipsWrap = H.el('div');
      chipsWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin:11px 0 9px;';
      body.appendChild(chipsWrap);

      function renderChips() {
        chipsWrap.innerHTML = '';
        C.HOTSPOTS.forEach(function (s) {
          var on = s.key === active;
          var painted = !emptyOf(masks[s.key]);
          var col = C.HOTSPOT_COLORS[s.key] || '#D97FA8';
          var chip = H.el('div');
          chip.style.cssText = 'display:inline-flex; align-items:center; gap:4px; padding:5px 10px; border-radius:11px;'
            + 'cursor:pointer; font-size:11px; font-weight:700; transition:all .18s ease;'
            + (on ? 'background:' + col + '; color:#fff; box-shadow:0 4px 12px ' + col + '55;'
              : 'background:rgba(255,255,255,0.8); color:#8b8292; border:1px solid rgba(190,180,195,0.28);');
          chip.innerHTML = '<span style="width:7px; height:7px; border-radius:50%; background:'
            + (on ? '#fff' : col) + ';' + (painted ? '' : 'opacity:.28;') + '"></span>'
            + '<span>' + U.esc(s.name) + '</span>';
          chip.title = painted ? '已涂抹' : '还没涂（留空也可以）';
          chip.onclick = function () {
            active = s.key;
            erase = false;
            renderTools();
            renderChips();
            drawMask();
          };
          chipsWrap.appendChild(chip);
        });
      }

      // ---------- 工具条 ----------
      var tools = H.el('div');
      tools.style.cssText = 'display:flex; align-items:center; gap:9px; flex-wrap:wrap;';
      body.appendChild(tools);
      var brushLabel;

      function renderTools() {
        tools.innerHTML = '';
        var paintB = H.button('画笔', {
          kind: erase ? 'soft' : 'primary', pad: '7px 13px', size: 11,
          soft: '#FFEBF3', color: '#B0728F'
        });
        paintB.onclick = function () { erase = false; renderTools(); };
        var eraseB = H.button('橡皮擦', {
          kind: erase ? 'primary' : 'soft', pad: '7px 13px', size: 11,
          soft: '#EDF2FB', color: '#5f7aa8'
        });
        eraseB.onclick = function () { erase = true; renderTools(); };
        tools.appendChild(paintB);
        tools.appendChild(eraseB);

        brushLabel = H.el('span');
        brushLabel.style.cssText = 'font-size:10.6px; color:#8b8292; font-weight:700;';
        brushLabel.textContent = '笔刷 ' + brush;
        tools.appendChild(brushLabel);

        var slider = H.el('input', { type: 'range', min: '1', max: '16', value: String(brush) });
        slider.style.cssText = 'flex:1; min-width:100px; accent-color:#D97FA8;';
        slider.oninput = function () { brush = Number(slider.value) || 1; brushLabel.textContent = '笔刷 ' + brush; };
        tools.appendChild(slider);

        var undoB = H.button('撤销', { kind: 'ghost', pad: '7px 11px', size: 11, color: '#9a8f9e' });
        undoB.onclick = function () {
          if (!undo.length) { H.toast('没有可撤销的操作'); return; }
          var prev = undo.pop();
          if (prev) masks[active] = prev; else delete masks[active];
          drawMask(); renderChips();
        };
        tools.appendChild(undoB);

        var clearB = H.button('清空此部位', { kind: 'ghost', pad: '7px 11px', size: 11, color: '#c2607c' });
        clearB.onclick = function () {
          undo.push(masks[active] ? masks[active].slice() : null);
          delete masks[active];
          drawMask(); renderChips();
          H.toast('已清空这个部位（会回落到默认椭圆）');
        };
        tools.appendChild(clearB);
      }

      renderTools();
      renderChips();
      drawMask();
      applyTransform();

      H.sheet({
        title: '热区涂抹划分',
        subtitle: (portrait ? portrait.name : '默认版式') + ' · 点部位 -> 涂抹 -> 保存',
        icon: 'hand',
        height: '94%',
        slot: 'hotspot-editor',
        content: body,
        buttons: [{
          text: '保存热区', icon: 'check', kind: 'primary',
          onClick: function () {
            var saved = 0, cleared = 0;
            C.HOTSPOTS.forEach(function (s) {
              var m = masks[s.key];
              if (m && !emptyOf(m)) { K.setMask(pid, s.key, m); saved++; }
              else if (K.maskOf(pid, s.key)) { K.setMask(pid, s.key, null); cleared++; }
            });
            K.save(true);
            H.toast('已保存 ' + saved + ' 个部位' + (cleared ? '（清空 ' + cleared + ' 个）' : ''));
            if (typeof onChanged === 'function') onChanged();
            if (window.heartGameApp && typeof window.heartGameApp.render === 'function') {
              try { window.heartGameApp.render(); } catch (e) { }
            }
          }
        }]
      });

      // 图片解码完成后再对齐一次（尺寸依赖 naturalWidth）
      if (img.complete) setTimeout(layoutCanvas, 0);
      else img.onload = function () { layoutCanvas(); };
      setTimeout(layoutCanvas, 60);
      window.addEventListener('resize', layoutCanvas);
      try {
        if (typeof ResizeObserver === 'function') {
          var roM = new ResizeObserver(layoutCanvas);
          roM.observe(stage);
        }
      } catch (e) { }
    },

    /**
     * 旧版「椭圆微调」编辑器（保留：涂抹版不适合精修单个部位的位置，
     * 这里可以拖圆心、缩放半径，并且能编辑每个部位的动作库）。
     */
    openHotspotEditor: function (onChanged) {
      var portrait = K.currentPortrait();
      var portraitId = portrait ? portrait.id : 'default';
      var body = H.el('div');
      var stage = H.el('div');
      stage.style.cssText = 'position:relative; width:100%; height:340px; border-radius:18px; overflow:hidden;'
        + 'background:linear-gradient(160deg,#FDF7FB 0%,#F4F1FA 100%); border:1px solid rgba(216,160,190,0.24);';
      body.appendChild(stage);

      var tip = H.el('div');
      tip.style.cssText = 'font-size:10.8px; line-height:1.72; color:#9a8f9e; margin:9px 2px 11px;';
      tip.innerHTML = '在立绘上直接拖动热区圆心调整位置，滚轮 / 双指缩放调整范围。'
        + '每个部位可单独绑定「交互等级」与「好感阶段响应动作库」。';
      body.appendChild(tip);

      var renderer = new SpriteRenderer({
        editable: true,
        showOverlay: true,
        onTouch: null,
        onSelect: function (key) { renderActionPanel(key); }
      });

      function mountStage() {
        stage.innerHTML = '';
        if (portrait && portrait.src) {
          renderer.mount(stage, portrait, { editable: true, fit: 'contain' });
        } else {
          stage.appendChild(Portraits.silhouette());
          var layer = H.el('div');
          layer.style.cssText = 'position:absolute; inset:0;';
          renderer.portraitId = portraitId;
          renderer.hotspots = K.hotspotsOf(portraitId);
          renderer.overlay = layer;
          renderer.root = layer;
          stage.appendChild(layer);
          renderer.renderHotspots({ editable: true, onSelect: function (key) { renderActionPanel(key); } });
        }
      }

      // 部位动作库面板
      var actionPanel = H.el('div');
      body.appendChild(actionPanel);

      function renderActionPanel(key) {
        actionPanel.innerHTML = '';
        if (!key) { actionPanel.appendChild(H.empty('点击立绘上的任意热区，可编辑它的响应动作库', { icon: 'hand' })); return; }
        var spot = C.HOTSPOTS.filter(function (s) { return s.key === key; })[0];
        var geom = K.hotspotsOf(portraitId)[key];
        actionPanel.appendChild(H.sectionTitle('热区：' + spot.name, { color: '#D97FA8' }));

        var meta = H.el('div');
        meta.style.cssText = 'display:flex; gap:8px; margin-bottom:10px;';
        meta.appendChild(H.chip('交互等级 ' + spot.order, { color: '#7E97C9', soft: '#EDF2FB' }));
        meta.appendChild(H.chip('范围 ' + U.round(geom.rx * 200, 0) + '% × ' + U.round(geom.ry * 200, 0) + '%', { color: '#B79EDC', soft: '#F3EEFF' }));
        actionPanel.appendChild(meta);

        var list = K.hotspotActionsOf(portraitId, key);
        if (!list.length) actionPanel.appendChild(H.empty('这个部位还没有专属动作，戳它时会由模型即时生成。', { icon: 'sparkle' }));
        list.slice(0, 6).forEach(function (a) {
          var row = H.listRow({
            icon: 'msg', color: '#D97FA8', soft: '#FFEBF3',
            title: a.text, subtitleWrap: true,
            subtitle: '阶段：' + K.tierOf(a.tier || 'acquaint').name + ' · ' + U.timeAgo(a.at),
            rightNode: (function () {
              var del = H.iconButton('trash', { size: 26, color: '#c2607c' });
              del.onclick = function (ev) {
                ev.stopPropagation();
                var saved = K.state.assets.hotspotActions[portraitId][key];
                var i = saved.indexOf(a);
                if (i >= 0) saved.splice(i, 1);
                K.save(true);
                renderActionPanel(key);
              };
              return del;
            })()
          });
          actionPanel.appendChild(row);
        });

        var addB = H.button('新增这个部位的动作', { kind: 'soft', block: true, icon: 'plus', soft: '#FFEBF3', color: '#B0728F' });
        addB.onclick = function () {
          H.prompt({
            title: '新增动作文案',
            message: '写下 TA 被碰到「' + spot.name + '」时的专属反应。留空则交给模型即时生成。',
            multiline: true, rows: 3, placeholder: '例如：TA 没有躲开，只是把视线落在了别处。'
          }).then(function (text) {
            if (!text) return;
            K.pushHotspotAction(portraitId, key, { text: text });
            renderActionPanel(key);
            H.toast('已绑定到当前阶段');
          });
        };
        actionPanel.appendChild(addB);

        var resetB = H.button('恢复该部位默认版式', { kind: 'ghost', block: true, icon: 'refresh', color: '#9a8f9e' });
        resetB.onclick = function () {
          var d = C.DEFAULT_HOTSPOTS()[key];
          K.setHotspot(portraitId, key, d);
          renderer.hotspots = K.hotspotsOf(portraitId);
          mountStage();
          renderActionPanel(key);
          H.toast('已恢复默认版式');
        };
        actionPanel.appendChild(resetB);
      }

      mountStage();
      renderActionPanel(null);

      H.sheet({
        title: '热区涂抹划分',
        subtitle: portrait ? portrait.name : '默认版式（尚未上传立绘）',
        icon: 'hand',
        height: '92%',
        content: body,
        buttons: [{
          text: '完成', icon: 'check', kind: 'primary',
          onClick: function () {
            K.save(true);
            H.toast('热区划分已保存');
            if (typeof onChanged === 'function') onChanged();
          }
        }]
      });
    },

    // ------------------------------------------------------------------
    //  4.4b 立绘 / 背景 位置与缩放编辑器（v1.5.38）
    //  用户：「人物下方存在比较大的空隙 …… 可以自由移动、放缩立绘以及背景，
    //        点击保存后此立绘与背景的位置持久化保存。」
    // ------------------------------------------------------------------

    openFitEditor: function (onChanged) {
      var portrait = K.currentPortrait();
      var bg = K.currentBackground();
      var pid = portrait ? portrait.id : 'default';
      var bgId = bg ? bg.id : 'none';

      // 内存里的两份 fit，保存时才落库
      var fits = {
        portrait: K.portraitFit(pid),
        background: K.backgroundFit(bgId)
      };
      var mode = 'portrait';       // 'portrait' | 'background'

      var body = H.el('div');

      // 模式切换
      var modeBar = H.el('div');
      modeBar.style.cssText = 'display:flex; gap:7px; margin-bottom:9px;';
      var paintMode = function () {
        modeBar.innerHTML = '';
        [['portrait', '调整立绘'], ['background', '调整背景']].forEach(function (m) {
          var on = mode === m[0];
          var b = H.el('button', { type: 'button' });
          b.style.cssText = 'flex:1; padding:8px 0; border-radius:12px; font-size:11.5px; font-weight:800;'
            + 'cursor:pointer; transition:all .18s ease;'
            + (on ? 'background:linear-gradient(135deg,#D97FA8,#B79EDC); color:#fff; border:none;'
              : 'background:rgba(255,255,255,0.82); color:#9a919f; border:1px solid rgba(190,180,195,0.28);');
          b.textContent = m[1];
          b.onclick = function () { mode = m[0]; paintMode(); paintTools(); };
          modeBar.appendChild(b);
        });
      };
      body.appendChild(modeBar);

      // 舞台：和看板一样的图层结构（背景 + 立绘），所见即所得
      var stage = H.el('div');
      stage.style.cssText = 'position:relative; width:100%; height:360px; border-radius:18px; overflow:hidden;'
        + 'background:linear-gradient(170deg,#FFF3F8 0%,#F6F1FB 48%,#EFF3FB 100%);'
        + 'border:1px solid rgba(216,160,190,0.24); touch-action:none;';
      body.appendChild(stage);

      var bgLayer = H.el('div');
      bgLayer.style.cssText = 'position:absolute; inset:0; background-size:cover; background-position:center;'
        + 'transform-origin:50% 50%;';
      if (bg && bg.src) bgLayer.style.backgroundImage = 'url(' + bg.src + ')';
      stage.appendChild(bgLayer);

      var img = H.el('img', { alt: '' });
      img.style.cssText = 'position:absolute; left:0; top:0; width:0; height:0;'
        + 'user-select:none; -webkit-user-drag:none; pointer-events:none;';
      if (portrait && portrait.src) img.src = portrait.src;
      stage.appendChild(img);

      var guide = H.el('div');
      guide.style.cssText = 'position:absolute; inset:0; pointer-events:none;'
        + 'background:linear-gradient(180deg, rgba(255,247,251,0.34) 0%, rgba(255,247,251,0.06) 26%,'
        + ' rgba(255,247,251,0.42) 74%, rgba(250,246,252,0.90) 100%),'
        + 'linear-gradient(180deg, rgba(255,247,251,0.10), rgba(60,40,70,0.22));';
      stage.appendChild(guide);

      var frame = H.el('div');
      frame.style.cssText = 'position:absolute; left:8px; right:8px; top:6%; bottom:104px;'
        + 'border:1.2px dashed rgba(217,127,168,0.55); border-radius:10px; pointer-events:none;';
      stage.appendChild(frame);

      // 手机屏幕外框（按主界面真实比例映射，方便判断"到底能不能放到这里"）
      var phoneFrame = H.el('div');
      phoneFrame.style.cssText = 'position:absolute; display:none; pointer-events:none;'
        + 'border:1px solid rgba(140,120,150,0.30); border-radius:12px;';
      stage.appendChild(phoneFrame);

      var badge = H.el('div');
      badge.style.cssText = 'position:absolute; left:8px; bottom:6px; font-size:10px; color:#8b8292;'
        + 'background:rgba(255,255,255,0.86); border-radius:8px; padding:3px 7px; pointer-events:none;';
      stage.appendChild(badge);

      /**
       * 读主界面**真实**的立绘区几何（v1.5.40）
       * 用户反馈「调整立绘和背景里面的视图跟主界面显示的视图不一致，主界面下面的空白区域立绘放不上去」——
       * 原因是这里原来用一个固定的 360px 舞台预览，和主界面的立绘区（top:6%; bottom:104px）
       * 比例完全不同。现在改成按主界面的真实矩形等比映射，所见即所得。
       */
      function lobbyMetrics() {
        try {
          var m = document.getElementById('heartgame-mount');
          var h = document.getElementById('hg-portrait-host');
          if (!m || !h) return null;
          var mr = m.getBoundingClientRect(), hr = h.getBoundingClientRect();
          if (!mr.width || !mr.height) return null;
          return { w: mr.width, h: mr.height, top: hr.top - mr.top, height: hr.height };
        } catch (e) { return null; }
      }

      function applyAll() {
        var bf = fits.background;
        bgLayer.style.transform = 'translate(' + (bf.x * 100) + '%,' + (bf.y * 100) + '%) scale(' + bf.scale + ')';

        var bw = stage.clientWidth, bh = stage.clientHeight;
        var met = lobbyMetrics();
        var k, boxW, boxH, boxX, boxY, hostTop, hostH;
        if (met) {
          k = Math.min(bw / met.w, bh / met.h);
          boxW = met.w * k; boxH = met.h * k;
          boxX = (bw - boxW) / 2; boxY = (bh - boxH) / 2;
          hostTop = boxY + met.top * k;
          hostH = met.height * k;
        } else {
          k = 1; boxW = bw; boxH = bh; boxX = 0; boxY = 0;
          hostTop = bh * 0.06; hostH = bh - hostTop - 60;
        }

        // 立绘按"主界面立绘区"的尺寸做 contain + 用户的 scale/偏移，位置再平移到那个框里
        var r = fitRect(boxW, hostH, img.naturalWidth || 1024, img.naturalHeight || 1536, fits.portrait);
        img.style.left = (boxX + r.dx) + 'px';
        img.style.top = (hostTop + r.dy) + 'px';
        img.style.width = r.dw + 'px';
        img.style.height = r.dh + 'px';

        // 虚线框 = 主界面立绘区；外面的细框 = 手机屏幕
        frame.style.left = (boxX + 8) + 'px';
        frame.style.right = 'auto';
        frame.style.width = (boxW - 16) + 'px';
        frame.style.top = hostTop + 'px';
        frame.style.height = hostH + 'px';
        phoneFrame.style.left = boxX + 'px';
        phoneFrame.style.top = boxY + 'px';
        phoneFrame.style.width = boxW + 'px';
        phoneFrame.style.height = boxH + 'px';
        phoneFrame.style.display = met ? 'block' : 'none';

        badge.textContent = '立绘 ' + U.round(fits.portrait.scale * 100, 0) + '% · 背景 '
          + U.round(fits.background.scale * 100, 0) + '%'
          + (met ? '' : '（未能读到主界面尺寸，按默认框预览）');
      }

      // 拖动当前选中的那一层
      var dragging = false, last = null;
      stage.onpointerdown = function (ev) {
        dragging = true;
        last = { x: ev.clientX, y: ev.clientY };
        try { stage.setPointerCapture && stage.setPointerCapture(ev.pointerId); } catch (e) { }
        var b = stage.getBoundingClientRect();
        stage._box = { w: b.width || 1, h: b.height || 1 };
      };
      stage.onpointermove = function (ev) {
        if (!dragging) return;
        ev.preventDefault();
        var b = stage._box || { w: 1, h: 1 };
        var f = fits[mode];
        // 手指移动 1px = 该层移动 1/舞台尺寸 的比例
        f.x = U.clamp(f.x + (ev.clientX - last.x) / b.w, -0.6, 0.6);
        f.y = U.clamp(f.y + (ev.clientY - last.y) / b.h, -0.6, 0.6);
        last = { x: ev.clientX, y: ev.clientY };
        applyAll();
        if (mode === 'portrait' && scaleLabel) { /* 缩放不变，只更新位置 */ }
      };
      var stopDrag = function () { dragging = false; };
      stage.onpointerup = stopDrag;
      stage.onpointercancel = stopDrag;

      // 工具条：缩放滑杆 + 复位
      var tools = H.el('div');
      tools.style.cssText = 'display:flex; align-items:center; gap:9px; margin-top:10px; flex-wrap:wrap;';
      body.appendChild(tools);
      var scaleLabel = null;

      function paintTools() {
        tools.innerHTML = '';
        scaleLabel = H.el('span');
        scaleLabel.style.cssText = 'font-size:10.8px; color:#8b8292; font-weight:800; min-width:66px;';
        scaleLabel.textContent = '缩放 ' + U.round(fits[mode].scale * 100, 0) + '%';
        tools.appendChild(scaleLabel);

        var slider = H.el('input', { type: 'range', min: '35', max: '260', value: String(Math.round(fits[mode].scale * 100)) });
        slider.style.cssText = 'flex:1; min-width:110px; accent-color:#D97FA8;';
        slider.oninput = function () {
          fits[mode].scale = U.clamp(Number(slider.value) / 100, 0.35, 2.6);
          scaleLabel.textContent = '缩放 ' + U.round(fits[mode].scale * 100, 0) + '%';
          applyAll();
        };
        tools.appendChild(slider);

        var nudge = H.el('div');
        nudge.style.cssText = 'display:flex; gap:5px; width:100%; margin-top:2px;';
        var mk = function (txt, fn) {
          var b = H.el('button', { type: 'button' });
          b.style.cssText = 'flex:1; padding:7px 0; border-radius:11px; font-size:11px; font-weight:800;'
            + 'cursor:pointer; border:1px solid rgba(190,180,195,0.3); background:rgba(255,255,255,0.85); color:#7d7484;';
          b.textContent = txt;
          b.onclick = fn;
          return b;
        };
        nudge.appendChild(mk('左移', function () { fits[mode].x = U.clamp(fits[mode].x - 0.02, -0.6, 0.6); applyAll(); }));
        nudge.appendChild(mk('右移', function () { fits[mode].x = U.clamp(fits[mode].x + 0.02, -0.6, 0.6); applyAll(); }));
        nudge.appendChild(mk('上移', function () { fits[mode].y = U.clamp(fits[mode].y - 0.02, -0.6, 0.6); applyAll(); }));
        nudge.appendChild(mk('下移', function () { fits[mode].y = U.clamp(fits[mode].y + 0.02, -0.6, 0.6); applyAll(); }));
        nudge.appendChild(mk('复位', function () {
          fits[mode] = { x: 0, y: 0, scale: 1 };
          paintTools();
          applyAll();
        }));
        tools.appendChild(nudge);
      }

      paintMode();
      paintTools();

      var tip = H.el('div');
      tip.style.cssText = 'font-size:10.6px; line-height:1.72; color:#9a8f9e; margin:10px 2px 0;';
      tip.textContent = '拖动画面 = 移动当前选中的那一层；下面滑杆控制大小。'
        + '虚线框是看板上立绘区域的位置，照着它对齐即可。保存后这套立绘 / 这张背景会记住自己的位置。';
      body.appendChild(tip);

      var paintAll = function () { applyAll(); };
      if (img.complete) setTimeout(paintAll, 0);
      else img.onload = paintAll;
      setTimeout(paintAll, 60);
      setTimeout(paintAll, 200);
      window.addEventListener('resize', paintAll);
      try {
        if (typeof ResizeObserver === 'function') {
          var ro = new ResizeObserver(paintAll);
          ro.observe(stage);
        }
      } catch (e) { }

      H.sheet({
        title: '调整立绘与背景',
        subtitle: '拖动移动 · 滑杆缩放 · 保存后按立绘/背景分别记住',
        icon: 'portrait',
        height: '92%',
        slot: 'fit-editor',
        content: body,
        buttons: [{
          text: '保存', icon: 'check', kind: 'primary',
          onClick: function () {
            K.setPortraitFit(pid, fits.portrait);
            K.setBackgroundFit(bgId, fits.background);
            K.save(true);
            H.toast('位置已保存');
            if (typeof onChanged === 'function') onChanged();
            if (window.heartGameApp && typeof window.heartGameApp.render === 'function') {
              try { window.heartGameApp.render(); } catch (e) { }
            }
          }
        }]
      });
    },

    // ------------------------------------------------------------------
    //  4.3 场景背景管理
    // ------------------------------------------------------------------

    openBackgroundManager: function (onChanged) {
      var body = H.el('div');
      var SCENES = ['卧室', '校园', '雨天', '黄昏', '街道', '咖啡店', '海边', '露台', '车内', '自定义'];

      function refresh() {
        body.innerHTML = '';
        var list = K.state.assets.backgrounds;
        if (!list.length) body.appendChild(H.empty('还没有场景背景。上传一张图，并标注它的场景属性。', { icon: 'bg' }));
        list.forEach(function (b) {
          var isCur = K.state.assets.currentBackgroundId === b.id;
          var row = H.listRow({
            title: b.name,
            subtitle: '场景：' + b.scene + (b.tags && b.tags.length ? ' · ' + b.tags.join(' / ') : ''),
            subtitleWrap: true,
            leftNode: (function () {
              var im = H.el('img', { alt: '' });
              im.src = b.src;
              im.style.cssText = 'width:46px; height:34px; border-radius:10px; object-fit:cover; flex-shrink:0;'
                + 'border:1px solid rgba(216,160,190,0.25);';
              return im;
            })(),
            rightNode: (function () {
              var box = H.el('div');
              box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
              if (isCur) box.appendChild(H.chip('使用中', { color: '#D97FA8', soft: '#FFEBF3' }));
              else {
                var b1 = H.button('使用', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#EDF2FB', color: '#5f7aa8' });
                b1.onclick = function (ev) {
                  ev.stopPropagation();
                  K.setCurrentBackground(b.id);
                  H.toast('已切换场景');
                  refresh();
                  if (typeof onChanged === 'function') onChanged();
                };
                box.appendChild(b1);
              }
              var del = H.iconButton('trash', { size: 26, color: '#c2607c' });
              del.onclick = function (ev) {
                ev.stopPropagation();
                K.removeBackground(b.id);
                refresh();
                if (typeof onChanged === 'function') onChanged();
              };
              box.appendChild(del);
              return box;
            })()
          });
          body.appendChild(row);
        });

        body.appendChild(H.sectionTitle('快捷场景标签', { color: '#7E97C9' }));
        var wrap = H.el('div');
        wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        SCENES.forEach(function (s) {
          wrap.appendChild(H.chip(s, { color: '#5f7aa8', soft: '#EDF2FB' }));
        });
        body.appendChild(wrap);
      }

      refresh();

      H.sheet({
        title: '场景背景管理',
        subtitle: '供主页看板与 VN 剧情引擎调用',
        icon: 'bg',
        height: '86%',
        slot: 'portrait-bg-manager',
        content: body,
        buttons: [{
          text: '上传背景', icon: 'upload', kind: 'primary',
          keepOpen: true,
          onClick: function () {
            Portraits.pickImage(1600, function (dataUrl) {
              H.prompt({ title: '背景名称', value: '新场景' }).then(function (name) {
                if (name === null) return;
                var scene = '自定义';
                H.sheet({
                  title: '场景属性',
                  icon: 'bg',
                  content: (function () {
                    var w = H.el('div');
                    var chips = H.el('div');
                    chips.style.cssText = 'display:flex; flex-wrap:wrap; gap:7px;';
                    SCENES.forEach(function (s) {
                      var chip = H.button(s, { kind: 'soft', pad: '7px 12px', size: 11.5, soft: '#EDF2FB', color: '#5f7aa8' });
                      chip.onclick = function () {
                        scene = s;
                        Array.prototype.forEach.call(chips.children, function (c) { c.style.background = '#EDF2FB'; });
                        chip.style.background = '#D9E6F8';
                      };
                      chips.appendChild(chip);
                    });
                    w.appendChild(chips);
                    return w;
                  })(),
                  buttons: [{
                    text: '保存', kind: 'primary',
                    onClick: function () {
                      K.addBackground({ name: name || '新场景', scene: scene, src: dataUrl });
                      H.toast('背景已添加');
                      refresh();
                      if (typeof onChanged === 'function') onChanged();
                    }
                  }]
                });
              });
            });
          }
        }]
      });
    },

    /** 选图并压缩（复用桌面模块的编码器，PNG 保留透明） */
    pickImage: function (maxPx, cb) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (input.parentNode) input.parentNode.removeChild(input);
        if (!file) return;
        var enc = window.tileEncodeImage;
        if (typeof enc !== 'function') { H.toast('图片编码器不可用'); return; }
        enc(file, maxPx).then(function (out) {
          if (!out) { H.toast('这张图片解析失败：可能是 HEIC 等本机不支持的格式'); return; }
          if (typeof cb === 'function') cb(out);
        });
      };
      input.click();
    },

    /** 选一个 zip 模型包 */
    pickZip: function (cb) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,application/zip,application/x-zip-compressed';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (input.parentNode) input.parentNode.removeChild(input);
        if (!file) return;
        if (typeof cb === 'function') cb(file);
      };
      input.click();
    },

    // ------------------------------------------------------------------
    //  4.4 后台管理界面（身份与字段注入 / 模式 / 难度 / 记忆格式化）
    // ------------------------------------------------------------------

    openAdmin: async function (onChanged) {
      var char = await K.charProfile();
      var user = await K.userProfile();
      var body = H.el('div');
      var st = K.state;

      // —— 双轨模式开关 ——
      body.appendChild(H.sectionTitle('世界线（双轨模式）', { color: '#D97FA8' }));
      var modeBox = H.el('div');
      modeBox.style.cssText = 'display:flex; gap:9px; margin-bottom:6px;';
      Object.keys(C.MODE).forEach(function (mk) {
        var on = st.mode === mk;
        var card = H.el('div');
        card.style.cssText = 'flex:1; border-radius:16px; padding:12px 12px 13px; cursor:pointer;'
          + 'transition:all .24s cubic-bezier(.22,1,.36,1); box-sizing:border-box;'
          + (on
            ? 'background:linear-gradient(150deg,#FFF1F7,#F6F0FF); border:1.6px solid rgba(217,127,168,0.65);'
              + 'box-shadow:0 9px 24px rgba(217,127,168,0.20);'
            : 'background:rgba(255,255,255,0.7); border:1.4px solid rgba(190,180,195,0.28);');
        card.innerHTML = '<div style="font-size:12.5px; font-weight:800; color:' + (on ? '#B0728F' : '#6f6779') + ';">'
          + C.MODE_LABEL[mk] + '</div>'
          + '<div style="font-size:10.4px; line-height:1.62; color:#9a8f9e; margin-top:5px;">' + C.MODE_DESC[mk] + '</div>';
        card.onclick = function () {
          K.setMode(mk);
          H.toast('已切换到「' + C.MODE_LABEL[mk] + '」');
          if (typeof onChanged === 'function') onChanged(true);
          openAdminRefresh();
        };
        modeBox.appendChild(card);
      });
      body.appendChild(modeBox);

      // —— 攻略难度调节器（攻略模式独占） ——
      if (st.mode === C.MODE.STRATEGY) {
        body.appendChild(H.sectionTitle('心动阻抗（好感增长倍率）', { color: '#B79EDC' }));
        var dbox = H.el('div');
        dbox.style.cssText = 'background:rgba(255,255,255,0.72); border:1px solid rgba(183,158,220,0.24);'
          + 'border-radius:16px; padding:12px; margin-bottom:4px;';
        var dIdx = C.DIFFICULTIES.map(function (d) { return d.key; }).indexOf(st.difficulty);
        var dLabel = H.el('div');
        dLabel.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:9px;';
        dLabel.innerHTML = '<span style="font-size:12.5px; font-weight:800; color:#7d63a8;">'
          + C.DIFFICULTIES[Math.max(0, dIdx)].name + '</span>'
          + '<span style="font-size:11px; color:#a99fae;">×' + C.DIFFICULTIES[Math.max(0, dIdx)].mult.toFixed(1) + '</span>';
        dbox.appendChild(dLabel);
        var dDesc = H.el('div');
        dDesc.style.cssText = 'font-size:10.6px; color:#9a8f9e; line-height:1.65; margin-bottom:9px;';
        dDesc.textContent = C.DIFFICULTIES[Math.max(0, dIdx)].desc;
        dbox.appendChild(dDesc);
        var slider = H.slider({
          min: 0, max: C.DIFFICULTIES.length - 1, step: 1, value: Math.max(0, dIdx),
          format: function (v) { return '×' + C.DIFFICULTIES[Number(v)].mult.toFixed(1); },
          onChange: function (v) {
            var d = C.DIFFICULTIES[Number(v)];
            dLabel.innerHTML = '<span style="font-size:12.5px; font-weight:800; color:#7d63a8;">' + d.name + '</span>'
              + '<span style="font-size:11px; color:#a99fae;">×' + d.mult.toFixed(1) + '</span>';
            dDesc.textContent = d.desc;
          }
        });
        dbox.appendChild(slider);
        var applyD = H.button('应用难度', { kind: 'soft', block: true, soft: '#F3EEFF', color: '#7d63a8' });
        applyD.style.marginTop = '10px';
        applyD.onclick = function () {
          var d = C.DIFFICULTIES[slider.getValue()];
          K.setDifficulty(d.key);
          H.toast('心动阻抗已设为「' + d.name + '」');
          if (typeof onChanged === 'function') onChanged(true);
        };
        dbox.appendChild(applyD);
        body.appendChild(dbox);
      } else {
        body.appendChild(H.sectionTitle('User 好感裁定权', { color: '#D97FA8' }));
        body.appendChild((function () {
          var box = H.el('div');
          box.style.cssText = 'background:rgba(255,255,255,0.72); border:1px solid rgba(216,160,190,0.24);'
            + 'border-radius:16px; padding:12px; margin-bottom:4px;';
          box.innerHTML = '<div style="font-size:10.8px; line-height:1.68; color:#9a8f9e; margin-bottom:10px;">'
            + '被攻略模式下，好感由你裁决。TA 会依据这个数值表现出狂喜、患得患失或占有欲。'
            + '</div>';
          var stepper = H.stepper({
            value: U.int(st.verdict.value, 0), step: 1, min: 0, max: 100, color: '#D97FA8',
            onChange: function (v) { st.verdict.value = v; }
          });
          box.appendChild(stepper);
          var quick = H.el('div');
          quick.style.cssText = 'display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;';
          [-5, -1, 1, 5, 10].forEach(function (n) {
            var b = H.button((n > 0 ? '+' : '') + n, {
              kind: 'soft', pad: '5px 11px', size: 11,
              soft: n > 0 ? '#FFEBF3' : '#EDF2FB', color: n > 0 ? '#B0728F' : '#5f7aa8'
            });
            b.onclick = function () {
              K.nudgeVerdict(n);
              stepper.setValue(K.state.verdict.value);
              if (typeof onChanged === 'function') onChanged(true);
            };
            quick.appendChild(b);
          });
          box.appendChild(quick);
          var moodRow = H.el('div');
          moodRow.style.cssText = 'margin-top:12px;';
          moodRow.appendChild(H.sectionTitle('心情指数', { color: '#B79EDC', margin: '0 0 7px' }));
          var moodWrap = H.el('div');
          moodWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
          C.MOODS.forEach(function (m) {
            var on = st.verdict.mood === m.key;
            var b = H.button(m.name, {
              kind: 'soft', pad: '6px 11px', size: 11,
              soft: on ? m.soft : 'rgba(240,236,244,0.7)', color: on ? m.color : '#9a919f'
            });
            if (on) b.style.boxShadow = '0 0 0 1.4px ' + m.color + '55';
            b.onclick = function () {
              K.setVerdict(K.state.verdict.value, { mood: m.key, note: st.verdict.note });
              H.toast('心情已设为「' + m.name + '」');
              if (typeof onChanged === 'function') onChanged(true);
              openAdminRefresh();
            };
            moodWrap.appendChild(b);
          });
          moodRow.appendChild(moodWrap);
          box.appendChild(moodRow);

          var noteRow = H.el('div');
          noteRow.style.cssText = 'margin-top:11px;';
          var noteInput = H.el('input', { type: 'text', placeholder: '给 TA 的一句裁定备注（会写进剧情上下文）' });
          noteInput.value = st.verdict.note || '';
          noteInput.style.cssText = 'width:100%; box-sizing:border-box; border-radius:11px;'
            + 'border:1px solid rgba(216,160,190,0.32); padding:8px 10px; font-size:11.5px; color:#5c4450;'
            + 'background:#fff; outline:none; font-family:inherit;';
          noteRow.appendChild(noteInput);
          noteRow.appendChild((function () {
            var b = H.button('保存裁定', { kind: 'primary', block: true, icon: 'check' });
            b.style.marginTop = '9px';
            b.onclick = function () {
              K.setVerdict(stepper.getValue(), { note: noteInput.value, mood: st.verdict.mood });
              H.toast('裁定已保存');
              if (typeof onChanged === 'function') onChanged(true);
            };
            return b;
          })());
          box.appendChild(noteRow);
          return box;
        })());
      }

      // —— 身份与字段注入 ——
      body.appendChild(H.sectionTitle('身份与字段注入', { color: '#7E97C9' }));
      function fieldRow(label, value, placeholder, onSave, opts) {
        var o = opts || {};
        var row = H.el('div');
        row.style.cssText = 'margin-bottom:9px;';
        var lab = H.el('div', {}, U.esc(label));
        lab.style.cssText = 'font-size:10.8px; font-weight:700; color:#8b8292; margin:0 2px 5px;';
        row.appendChild(lab);
        var input = o.multiline
          ? H.el('textarea', { rows: o.rows || 3, placeholder: placeholder || '' })
          : H.el('input', { type: 'text', placeholder: placeholder || '' });
        input.value = value || '';
        input.style.cssText = 'width:100%; box-sizing:border-box; border-radius:12px;'
          + 'border:1px solid rgba(148,163,184,0.30); padding:9px 11px; font-size:11.8px; color:#5c4450;'
          + 'background:rgba(255,255,255,0.86); outline:none; font-family:inherit; line-height:1.62; resize:vertical;';
        row.appendChild(input);
        var save = H.button('写入', { kind: 'ghost', pad: '6px 11px', size: 10.8, color: '#5f7aa8', icon: 'save' });
        save.style.cssText += 'margin-top:6px; background:rgba(237,242,251,0.85); border-radius:10px;';
        save.onclick = function () {
          onSave(input.value);
          H.toast('已写入：' + label);
          if (typeof onChanged === 'function') onChanged(true);
        };
        row.appendChild(save);
        return row;
      }

      body.appendChild((function () {
        var w = H.el('div');
        w.appendChild(fieldRow('User 称谓（覆盖）', user.name, '留空则使用档案库名称', function (v) {
          st.overrides.user = st.overrides.user || {};
          st.overrides.user.name = v;
          K.save(true);
        }));
        w.appendChild(fieldRow('User 外观描述', (st.overrides.user && st.overrides.user.appearance) || '', '例如：短发、浅色针织衫、耳后有一颗痣', function (v) {
          st.overrides.user.appearance = v;
          K.save(true);
        }, { multiline: true }));
        w.appendChild(fieldRow('User 性格标签', ((st.overrides.userTags || []).join(' / ')), '例如：嘴硬心软 / 慢热 / 占有欲强（用 / 分隔）', function (v) {
          st.overrides.userTags = String(v || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
          K.save(true);
        }));
        w.appendChild(fieldRow('User 好感反应偏好', st.overrides.userReact || '', '例如：被直球告白会炸毛，吃醋时反而黏人', function (v) {
          st.overrides.userReact = v;
          K.save(true);
        }, { multiline: true }));
        return w;
      })());

      body.appendChild(H.divider());

      body.appendChild((function () {
        var w = H.el('div');
        w.appendChild(fieldRow('Char 底层设定字段（覆盖）', char.persona, '留空则使用档案库 persona', function (v) {
          st.overrides.char = st.overrides.char || {};
          st.overrides.char.persona = v;
          K.save(true);
        }, { multiline: true, rows: 4 }));
        w.appendChild(fieldRow('Char 称谓（覆盖）', char.name, '留空则使用档案库名称', function (v) {
          st.overrides.char.name = v;
          K.save(true);
        }));
        return w;
      })());

      // —— 记忆与进度格式化 ——
      body.appendChild(H.sectionTitle('记忆与进度格式化', { color: '#9FB3D9' }));
      body.appendChild((function () {
        var note = H.el('div');
        note.style.cssText = 'font-size:10.6px; line-height:1.7; color:#9a8f9e; margin-bottom:10px;'
          + 'background:rgba(237,242,251,0.7); border:1px solid rgba(159,179,217,0.25); border-radius:13px; padding:10px 12px;';
        note.innerHTML = '以下操作<b>只清除心动游戏自己的数据</b>，'
          + '档案库里的 User 与 Char 原生设定（称谓 / 人设 / 头像）不受任何影响。';
        return note;
      })());
      var SCOPES = [
        { key: 'affinity', name: '好感阶梯', desc: '好感经验、晋阶任务完成表、好感流水' },
        { key: 'story', name: '主线节点', desc: '篇章进度、分支回溯树、剧情内小手机' },
        { key: 'quiet', name: '静室历史', desc: '静室对话流与系统日志' },
        { key: 'quests', name: '任务进度', desc: '每日 / 周常 / 动态委托 / 宝箱' },
        { key: 'shop', name: '商店与钱包', desc: '已购商品、上架商品、代币与代金券' },
        { key: 'gacha', name: '抽卡记录', desc: '卡册、保底计数、抽卡流水' },
        { key: 'bond', name: '羁绊足迹', desc: '时空足迹与重要记忆回廊' }
      ];
      SCOPES.forEach(function (s) {
        var row = H.listRow({
          icon: 'trash', color: '#9FB3D9', soft: '#EDF2FB',
          title: '清除' + s.name,
          subtitle: s.desc, subtitleWrap: true,
          rightNode: H.button('清除', { kind: 'ghost', pad: '5px 10px', size: 10.5, color: '#c2607c' })
        });
        row.onclick = function () {
          H.confirm({
            title: '清除' + s.name + '？',
            icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
            message: s.desc + '。\n\nUser 原生档案不受影响。此操作不可撤销。',
            okText: '确认清除'
          }).then(function (ok) {
            if (!ok) return;
            K.clearScope(s.key).then(function () {
              H.toast('已清除：' + s.name);
              if (typeof onChanged === 'function') onChanged(true);
            });
          });
        };
        body.appendChild(row);
      });

      var allB = H.button('格式化全部心动游戏数据（保留立绘与背景）', {
        kind: 'danger', block: true, icon: 'trash'
      });
      allB.onclick = function () {
        H.confirm({
          title: '格式化全部数据',
          icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
          message: '将清空好感、主线、静室、任务、商店、抽卡、羁绊的全部进度。\n'
            + '立绘、背景与 User / Char 原生档案会保留。\n\n此操作不可撤销。',
          okText: '全部清除'
        }).then(function (ok) {
          if (!ok) return;
          K.clearScope('all').then(function () {
            H.toast('已格式化');
            if (typeof onChanged === 'function') onChanged(true);
            openAdminRefresh();
          });
        });
      };
      body.appendChild(allB);

      function openAdminRefresh() {
        // 重新打开以刷新（模式切换后区块结构会变）
        Portraits.openAdmin(onChanged);
      }

      // ------------------------------------------------------------------
      //  结构化输出方案切换（v1.5.45）
      //  用户："跟聊天加号展开栏的查手机一样做两套方案，json数组和文字标签。在后台管理里切换。"
      // ------------------------------------------------------------------
      var modeSection = H.el('div');
      modeSection.appendChild(H.sectionTitle('生成输出方案', { color: '#7E97C9' }));
      var modeTip = H.el('div');
      modeTip.style.cssText = 'font-size:10.6px; line-height:1.7; color:#8b8292; background:rgba(237,242,251,0.8);'
        + 'border:1px solid rgba(159,179,217,0.22); border-radius:13px; padding:10px 12px; margin-bottom:10px;';
      modeTip.textContent = '主线剧情、商店上新、卡池生成这些地方要让模型按固定格式回话。'
        + 'JSON 方案更省 token，但有些模型爱加 ``` 围栏或前后废话导致失败；'
        + '文字标签方案用「键：值」的写法，对中文模型宽容得多。哪个能用就用哪个。';
      modeSection.appendChild(modeTip);
      var modeBar = H.el('div');
      modeBar.style.cssText = 'display:flex; gap:8px; margin-bottom:10px;';
      var paintMode = function () {
        modeBar.innerHTML = '';
        [['json', 'JSON 数组'], ['tag', '文字标签']].forEach(function (m) {
          var on = K.outputMode() === m[0];
          var b = H.button(m[1], {
            kind: on ? 'primary' : 'soft', block: true,
            soft: '#EDF2FB', color: '#5f7aa8', pad: '8px 0', size: 11
          });
          b.onclick = function () {
            K.setOutputMode(m[0]);
            H.toast('已切换到「' + m[1] + '」方案');
            paintMode();
          };
          modeBar.appendChild(b);
        });
      };
      paintMode();
      modeSection.appendChild(modeBar);
      body.appendChild(modeSection);

      // ------------------------------------------------------------------
      //  文风管理器（v1.5.41，用户标了高优先级）
      //  「主线剧情有时候生成的很短小很不好看。我们后台管理里要加一个文风管理器，
      //    可以新增文风管理，优先级别要高。」
      // ------------------------------------------------------------------
      var styleSection = H.el('div');
      styleSection.id = 'hg-style-manager';
      function paintStyles() {
        styleSection.innerHTML = '';
        styleSection.appendChild(H.sectionTitle('文风管理器', { color: '#B79EDC' }));
        var tip = H.el('div');
        tip.style.cssText = 'font-size:10.6px; line-height:1.7; color:#8b8292; background:rgba(243,238,255,0.7);'
          + 'border:1px solid rgba(183,158,220,0.22); border-radius:13px; padding:10px 12px; margin-bottom:10px;';
        tip.textContent = '选中的文风会拼进主线剧情 / 卡池 / 静室的生成提示词，并且会附带"篇幅与质量下限"，'
          + '避免生成得又短又空。内置文风不能删，但可以照着新增自己的。';
        styleSection.appendChild(tip);

        var activeId = K.state.activeStyleId;
        K.allStyles().forEach(function (s) {
          var on = activeId === s.id;
          var row = H.listRow({
            icon: s.builtin ? 'book' : 'edit',
            color: on ? '#D97FA8' : '#9FB3D9',
            soft: on ? '#FFEBF3' : '#EDF2FB',
            title: s.name + (on ? '（当前）' : ''),
            subtitle: (s.desc || '') + (s.builtin ? ' · 内置' : ' · 自定义'),
            subtitleWrap: true,
            rightNode: (function () {
              var box = H.el('div');
              box.style.cssText = 'display:flex; gap:6px; align-items:center; flex-shrink:0;';
              if (!on) {
                var useB = H.button('设为当前', { kind: 'soft', pad: '5px 9px', size: 10.5, soft: '#FFEBF3', color: '#B0728F' });
                useB.onclick = function (ev) {
                  ev.stopPropagation();
                  K.setActiveStyle(s.id);
                  H.toast('已切换到「' + s.name + '」');
                  paintStyles();
                };
                box.appendChild(useB);
              }
              if (!s.builtin) {
                var editB = H.iconButton('edit', { size: 26, color: '#B79EDC', title: '编辑' });
                editB.onclick = function (ev) {
                  ev.stopPropagation();
                  H.prompt({
                    title: '编辑文风：' + s.name,
                    message: '写下这套文风的写作规范（会直接拼进提示词）。',
                    multiline: true, rows: 6, value: s.prompt || ''
                  }).then(function (txt) {
                    if (txt === null) return;
                    K.updateStyle(s.id, { prompt: txt });
                    H.toast('已保存');
                    paintStyles();
                  });
                };
                box.appendChild(editB);
                var delB = H.iconButton('trash', { size: 26, color: '#c2607c' });
                delB.onclick = function (ev) {
                  ev.stopPropagation();
                  H.confirm({
                    title: '删除文风', icon: 'trash', accent: '#c2607c', soft: '#FFEFF3',
                    message: '删除「' + s.name + '」？', okText: '删除'
                  }).then(function (ok) {
                    if (!ok) return;
                    K.removeStyle(s.id);
                    H.toast('已删除');
                    paintStyles();
                  });
                };
                box.appendChild(delB);
              }
              return box;
            })()
          });
          row.onclick = null;
          styleSection.appendChild(row);
        });

        var addB = H.button('新增文风', { kind: 'primary', block: true, icon: 'plus' });
        addB.onclick = async function () {
          var name = await H.prompt({ title: '文风名称', placeholder: '例如：雨夜电影感', value: '' });
          if (!name) return;
          var desc = await H.prompt({ title: '一句话说明', placeholder: '例如：冷调、长镜头、大量留白', value: '' });
          if (desc === null) return;
          var bodyTxt = await H.prompt({
            title: '写作规范',
            message: '这套文风具体怎么写？越具体越有效（视角、句式、用词、节奏、要避免什么）。',
            multiline: true, rows: 6, placeholder: '例如：以长镜头式的环境描写开场，句子偏长但每段只推进一件事；'
              + '对白极少，靠动作与停顿传情；禁止出现感叹号。'
          });
          if (!bodyTxt) return;
          var row = K.addStyle({ name: name, desc: desc, prompt: bodyTxt });
          if (row) { K.setActiveStyle(row.id); H.toast('已新增并设为当前'); }
          paintStyles();
        };
        styleSection.appendChild(addB);
      }
      paintStyles();
      body.appendChild(styleSection);

      return H.sheet({
        title: '后台管理',
        subtitle: '世界线 · 身份字段 · 记忆格式化 · 文风',
        icon: 'admin',
        height: '92%',
        slot: 'portrait-admin',
        content: body
      });
    },

    // ------------------------------------------------------------------
    //  4.5 生命周期
    // ------------------------------------------------------------------

    /** 页面销毁：卸载 Live2D 实例、回收资源池、释放 zip 导入的 blob URL、清理定时器 */
    teardown: function () {
      if (Portraits.live2d && typeof Portraits.live2d.destroy === 'function') {
        try { Portraits.live2d.destroy(); } catch (e) {}
      }
      Portraits.live2d = null;
      if (Portraits.renderer) Portraits.renderer.teardown();
      Portraits.renderer = null;
      // zip 导入产生的 blob URL 必须显式释放，否则整包贴图会一直留在内存里
      (Portraits._zipRecords || []).forEach(function (rec) {
        try { ZipModel.release(rec); } catch (e) {}
      });
      Portraits._zipRecords = [];
      Portraits.pool.clear();
      // 同步内存态的池顺序（避免下次进来引用已卸载资源）
      if (K.state && K.state.assets) K.state.assets.pool = [];
      Portraits._stage = null;
    },

    poolStats: function () { return Portraits.pool.stats(); }
  };

  // 给静态渲染器补上动画样式（命中反馈）
  (function () {
    if (document.getElementById('heartgame-portrait-style')) return;
    var s = document.createElement('style');
    s.id = 'heartgame-portrait-style';
    s.textContent = '@keyframes hg-hit-react{0%{transform:translateX(-50%) scale(1)}'
      + '18%{transform:translateX(-50%) scale(1.028) rotate(-.5deg)}'
      + '42%{transform:translateX(-50%) scale(.992) rotate(.5deg)}'
      + '70%{transform:translateX(-50%) scale(1.012)}'
      + '100%{transform:translateX(-50%) scale(1)}}'
      + '.hg-portrait-img.hg-hit-react{animation:hg-hit-react .82s cubic-bezier(.22,1,.36,1), hg-breathe 4.6s ease-in-out infinite;}'
      + '.hg-touch-edit{touch-action:none;}';
    (document.head || document.documentElement).appendChild(s);
  })();

  HG.Portraits = Portraits;
  HG.AssetPool = AssetPool;
  /** 纯几何工具（可在 Node 里直接单测，不依赖浏览器） */
  HG.fitRect = fitRect;
  HG.normInRect = normInRect;
  /** ZIP 模型包导入器（Live2D 最省事的用法：把整包 zip 丢进来） */
  HG.ZipModel = ZipModel;
})();
