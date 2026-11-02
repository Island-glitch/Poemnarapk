/**
 * app_floating_widget.js - 全局悬浮窗组件
 * ------------------------------------------------------------
 * 职责：
 *   1. 设置-数据管理下的「悬浮窗」设置页（开关 / 样式 / 快捷入口配置）
 *   2. 全局悬浮窗主体：可拖动、左右吸附、3 秒无操作变透明、所有页面常驻
 *   3. 点击展开卡片：API 栏（当前 API / 切换预设 / 最新 token / 报错日志）+ 快捷入口列表
 *   4. 采集最新一轮 API 调用的 token 用量与报错（供卡片展示）
 *
 * 配置存储：localStorage("floating-widget-config") -> JSON
 *   { enabled, image(base64/URL), opacity(0.2-1), size(px), entries:[{appId,label,special?}] }
 * ============================================================
 */
(function () {
  "use strict";

  const CONFIG_KEY = "floating-widget-config";
  const IDLE_TIMEOUT = 3000;      // 3 秒无操作后变透明
  const IDLE_OPACITY = 0.12;      // 透明态透明度
  const MAX_ENTRIES = 5;          // 最多 5 个快捷入口

  // 可选快捷入口（所有主页应用 + API设置页 + 数据管理页）
  const AVAILABLE_ENTRIES = [
    { appId: "chat", label: "聊天" },
    { appId: "settings", label: "设置" },
    { appId: "archive", label: "档案馆" },
    { appId: "world_book", label: "世界书" },
    { appId: "encounter", label: "邂逅" },
    { appId: "deeptalk", label: "深谈" },
    { appId: "reader", label: "阅读" },
    { appId: "forum", label: "论坛" },
    { appId: "couples", label: "情侣空间" },
    { appId: "music", label: "听歌" },
    { appId: "shopping", label: "购物" },
    { appId: "quicktravel", label: "快穿局" },
    { appId: "yigui", label: "仪轨" },
    { special: "settings-api", label: "API 设置页" },
    { special: "settings-data", label: "数据管理页" }
  ];

  function defaultConfig() {
    return { enabled: false, image: "", opacity: 1, size: 56, entries: [] };
  }

  function entryId(e) { return e.special ? "special:" + e.special : "app:" + e.appId; }

  const floatingWidgetSystem = {
    config: null,
    widgetEl: null,
    cardEl: null,
    idleTimer: null,
    isIdle: false,
    _lastApiInfo: null,   // {inputTokens, outputTokens, totalTokens, model, time}
    _errorLog: [],        // [{time, message}]
    _mounted: false,

    // ===== 配置读写 =====
    getConfig: function () {
      if (this.config) return this.config;
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        this.config = raw ? Object.assign(defaultConfig(), JSON.parse(raw)) : defaultConfig();
      } catch (e) { this.config = defaultConfig(); }
      return this.config;
    },

    saveConfig: function () {
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config || defaultConfig())); } catch (e) {}
    },

    // ===== 设置页 HTML 模板（由 app_router 懒注入）=====
    getSettingsPanelHTML: function () {
      return `
        <div id="settings-lv2-floating-widget" class="settings-lv2-panel" style="display:none;">
          <div class="form-group" style="display:flex; align-items:center; justify-content:space-between;">
            <label style="font-weight:600;">开启悬浮窗</label>
            <label class="switch">
              <input type="checkbox" id="fw-enable-toggle">
              <span class="slider"></span>
            </label>
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-bottom:14px; line-height:1.6;">
            开启后，一个可拖动的悬浮窗会出现在所有页面。3 秒无操作自动变透明不遮挡视野，点击它可展开快捷卡片。下方配置样式与快捷入口。
          </div>

          <div class="form-group">
            <label style="font-weight:600;">样式</label>
          </div>
          <div class="form-group">
            <label>悬浮窗图片（支持透明 .png 或普通 .jpg）</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" id="fw-image-url" placeholder="图片 URL 或上传本地图片" style="flex:1;">
              <button type="button" class="btn" id="fw-image-upload" style="flex-shrink:0; white-space:nowrap;">上传</button>
              <button type="button" class="btn btn-outline" id="fw-image-clear" style="flex-shrink:0;">清除</button>
            </div>
            <div id="fw-image-preview-wrap" style="margin-top:8px; display:none;">
              <div id="fw-image-preview" style="width:56px; height:56px; border-radius:50%; background-size:cover; background-position:center; border:1px solid var(--border);"></div>
            </div>
          </div>
          <div class="form-group">
            <label>透明度 <span id="fw-opacity-val" style="color:var(--primary); font-weight:600;">100%</span></label>
            <input type="range" id="fw-opacity-range" min="20" max="100" value="100" style="width:100%;">
          </div>
          <div class="form-group">
            <label>大小 <span id="fw-size-val" style="color:var(--primary); font-weight:600;">56px</span></label>
            <input type="range" id="fw-size-range" min="40" max="120" value="56" style="width:100%;">
          </div>

          <div class="form-group">
            <label style="font-weight:600;">快捷入口（最多 ${MAX_ENTRIES} 个）</label>
          </div>
          <div id="fw-entries-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;"></div>
          <div class="form-group">
            <label>添加快捷入口</label>
            <select id="fw-entry-add-select" style="width:100%;"></select>
          </div>
          <button type="button" class="btn btn-outline" id="fw-entry-add-btn" style="width:100%; margin-bottom:8px;">+ 添加</button>
          <div style="font-size:10px; color:var(--text-secondary);">点击悬浮窗展开后，可在卡片里快速跳转到这些入口。</div>
        </div>
      `;
    },

    // ===== 设置页初始化（绑定事件）=====
    initSettingsPanel: function () {
      const cfg = this.getConfig();
      const self = this;
      const toggle = document.getElementById("fw-enable-toggle");
      if (toggle) { toggle.checked = !!cfg.enabled; toggle.onchange = () => { cfg.enabled = toggle.checked; self.saveConfig(); if (cfg.enabled) self.mountWidget(); else self.unmountWidget(); }; }

      const urlInput = document.getElementById("fw-image-url");
      if (urlInput) { urlInput.value = cfg.image || ""; urlInput.oninput = () => { cfg.image = urlInput.value.trim(); self.saveConfig(); self.flashActive(); self.applyAppearance(); self.refreshImagePreview(); }; }

      const upBtn = document.getElementById("fw-image-upload");
      if (upBtn) upBtn.onclick = () => self.handleImageUpload();

      const clrBtn = document.getElementById("fw-image-clear");
      if (clrBtn) clrBtn.onclick = () => { cfg.image = ""; self.saveConfig(); if (urlInput) urlInput.value = ""; self.flashActive(); self.applyAppearance(); self.refreshImagePreview(); };

      const opRange = document.getElementById("fw-opacity-range");
      const opVal = document.getElementById("fw-opacity-val");
      if (opRange) { opRange.value = Math.round((cfg.opacity != null ? cfg.opacity : 1) * 100); if (opVal) opVal.textContent = opRange.value + "%"; opRange.oninput = () => { cfg.opacity = opRange.value / 100; if (opVal) opVal.textContent = opRange.value + "%"; self.saveConfig(); self.flashActive(); self.applyAppearance(); }; }

      const szRange = document.getElementById("fw-size-range");
      const szVal = document.getElementById("fw-size-val");
      if (szRange) { szRange.value = cfg.size || 56; if (szVal) szVal.textContent = szRange.value + "px"; szRange.oninput = () => { cfg.size = parseInt(szRange.value); if (szVal) szVal.textContent = szRange.value + "px"; self.saveConfig(); self.flashActive(); self.applyAppearance(); }; }

      this.refreshImagePreview();
      this.renderEntriesList();
      this.refreshAddSelect();

      // 添加快捷入口按钮
      const addBtn = document.getElementById("fw-entry-add-btn");
      if (addBtn) addBtn.onclick = () => this.addEntry();
    },

    // 短暂激活悬浮窗（从设置页改样式时让用户看到效果）
    flashActive: function () {
      if (!this.widgetEl) return;
      this.setActive();
      this.resetIdleTimer();
    },

    // 添加一个快捷入口
    addEntry: function () {
      const cfg = this.getConfig();
      if (cfg.entries.length >= MAX_ENTRIES) {
        if (typeof showToast === "function") showToast("最多只能添加 " + MAX_ENTRIES + " 个快捷入口");
        return;
      }
      const sel = document.getElementById("fw-entry-add-select");
      if (!sel || !sel.value) return;
      const id = sel.value;
      const entry = AVAILABLE_ENTRIES.find(e => entryId(e) === id);
      if (!entry) return;
      cfg.entries.push(Object.assign({}, entry));
      this.saveConfig();
      this.renderEntriesList();
      this.refreshAddSelect();
      // 若卡片正打开，同步刷新
      if (this.cardEl && this.cardEl.classList.contains("active")) this.renderCardEntries();
      if (typeof showToast === "function") showToast("已添加：" + (entry.label || "入口"));
    },

    refreshImagePreview: function () {
      const cfg = this.getConfig();
      const wrap = document.getElementById("fw-image-preview-wrap");
      const prev = document.getElementById("fw-image-preview");
      if (!wrap || !prev) return;
      if (cfg.image) { wrap.style.display = "block"; prev.style.backgroundImage = "url('" + cfg.image + "')"; }
      else { wrap.style.display = "none"; }
    },

    // 图片上传（Canvas 压缩为 base64，透明 PNG 保留 PNG，否则 JPEG）
    handleImageUpload: function () {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { if (typeof showToast === "function") showToast("图片过大，请选 10MB 以内"); return; }
        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
            const maxSide = 256;
            let w = img.width, h = img.height;
            if (w > maxSide || h > maxSide) {
              if (w >= h) { h = Math.round(h * maxSide / w); w = maxSide; }
              else { w = Math.round(w * maxSide / h); h = maxSide; }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const isPng = file.type === "image/png";
            const dataUrl = isPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
            const cfg = this.getConfig();
            cfg.image = dataUrl;
            this.saveConfig();
            const urlInput = document.getElementById("fw-image-url");
            if (urlInput) urlInput.value = dataUrl;
            this.flashActive();
            this.applyAppearance();
            this.refreshImagePreview();
            if (typeof showToast === "function") showToast("图片已上传");
          };
          img.onerror = () => { if (typeof showToast === "function") showToast("图片加载失败"); };
          img.src = evt.target.result;
        };
        reader.onerror = () => { if (typeof showToast === "function") showToast("文件读取失败"); };
        reader.readAsDataURL(file);
      };
      fileInput.click();
    },

    // ===== 快捷入口列表渲染 =====
    renderEntriesList: function () {
      const cfg = this.getConfig();
      const list = document.getElementById("fw-entries-list");
      if (!list) return;
      if (cfg.entries.length === 0) {
        list.innerHTML = '<div style="font-size:11px; color:var(--text-secondary); text-align:center; padding:8px;">还没有添加快捷入口</div>';
        return;
      }
      list.innerHTML = "";
      cfg.entries.forEach((entry, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--bg-main); border-radius:8px; border:1px solid var(--border);";
        row.innerHTML = '<span style="flex:1; font-size:13px;">' + (entry.label || "未命名") + '</span>';
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-outline";
        delBtn.style.cssText = "padding:4px 10px; font-size:11px;";
        delBtn.textContent = "移除";
        delBtn.onclick = () => { cfg.entries.splice(idx, 1); this.saveConfig(); this.renderEntriesList(); this.refreshAddSelect(); if (this.cardEl && this.cardEl.classList.contains("active")) this.renderCardEntries(); };
        row.appendChild(delBtn);
        list.appendChild(row);
      });
    },

    refreshAddSelect: function () {
      const cfg = this.getConfig();
      const sel = document.getElementById("fw-entry-add-select");
      if (!sel) return;
      const usedIds = new Set(cfg.entries.map(entryId));
      const available = AVAILABLE_ENTRIES.filter(e => !usedIds.has(entryId(e)));
      sel.innerHTML = "";
      if (available.length === 0 || cfg.entries.length >= MAX_ENTRIES) {
        const opt = document.createElement("option");
        opt.textContent = cfg.entries.length >= MAX_ENTRIES ? "已达上限（" + MAX_ENTRIES + " 个）" : "无可添加入口";
        opt.disabled = true;
        sel.appendChild(opt);
        const addBtn = document.getElementById("fw-entry-add-btn");
        if (addBtn) addBtn.disabled = true;
        return;
      }
      const addBtn = document.getElementById("fw-entry-add-btn");
      if (addBtn) addBtn.disabled = false;
      available.forEach(e => {
        const opt = document.createElement("option");
        opt.value = entryId(e);
        opt.textContent = e.label;
        sel.appendChild(opt);
      });
    },

    // ===== 悬浮窗主体生命周期 =====
    mountWidget: function () {
      if (this._mounted) { this.applyAppearance(); return; }
      const container = document.getElementById("phone-container") || document.body;
      const widget = document.createElement("div");
      widget.id = "floating-widget";
      widget.style.cssText = "position:fixed; z-index:99999; right:12px; bottom:90px; border-radius:50%; cursor:pointer; touch-action:none; user-select:none; -webkit-user-select:none; box-shadow:0 4px 12px rgba(0,0,0,0.25); overflow:hidden; background-size:cover; background-position:center; background-repeat:no-repeat; transition:opacity 0.4s ease, left 0.25s cubic-bezier(0.2,0.9,0.3,1.1), right 0.25s cubic-bezier(0.2,0.9,0.3,1.1), width 0.2s, height 0.2s;";
      container.appendChild(widget);
      this.widgetEl = widget;

      // 默认图标（无图片时显示）
      this.applyAppearance();
      this.initInteraction();
      this.resetIdleTimer();
      this._mounted = true;
    },

    unmountWidget: function () {
      if (this.cardEl) { this.cardEl.remove(); this.cardEl = null; }
      if (this.widgetEl) { this.widgetEl.remove(); this.widgetEl = null; }
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
      this._mounted = false;
    },

    applyAppearance: function () {
      const cfg = this.getConfig();
      const w = this.widgetEl;
      if (!w) return;
      const size = cfg.size || 56;
      w.style.width = size + "px";
      w.style.height = size + "px";
      if (cfg.image) {
        w.style.backgroundImage = "url('" + cfg.image + "')";
        w.style.backgroundColor = "transparent";
        w.innerHTML = "";
      } else {
        w.style.backgroundImage = "";
        w.style.backgroundColor = "linear-gradient(135deg, #6366f1, #8b5cf6)";
        w.innerHTML = '<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#fff;"><svg viewBox="0 0 24 24" width="' + Math.round(size * 0.5) + '" height="' + Math.round(size * 0.5) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>';
      }
      if (!this.isIdle) w.style.opacity = (cfg.opacity != null ? cfg.opacity : 1);
    },

    // ===== 拖拽 / 吸附 / 点击 / 透明态 =====
    initInteraction: function () {
      const w = this.widgetEl;
      if (!w) return;
      let dragStartX = 0, dragStartY = 0, wStartX = 0, wStartY = 0, dragging = false, moved = false;

      const onDown = (e) => {
        dragging = true; moved = false;
        this.setActive();
        const rect = w.getBoundingClientRect();
        const parent = w.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        dragStartX = e.clientX; dragStartY = e.clientY;
        wStartX = rect.left - parentRect.left;
        wStartY = rect.top - parentRect.top;
        w.style.transition = "opacity 0.4s ease";
        try { w.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        const parent = w.offsetParent || document.body;
        let newX = wStartX + dx;
        let newY = wStartY + dy;
        const maxX = parent.clientWidth - w.offsetWidth;
        const maxY = parent.clientHeight - w.offsetHeight;
        newX = Math.max(0, Math.min(newX, Math.max(0, maxX)));
        newY = Math.max(0, Math.min(newY, Math.max(0, maxY)));
        w.style.right = "auto";
        w.style.left = newX + "px";
        w.style.top = newY + "px";
      };
      const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        try { w.releasePointerCapture(e.pointerId); } catch (err) {}
        if (moved) { this.snapToEdge(); this.resetIdleTimer(); }
        else { this.toggleCard(); this.resetIdleTimer(); }
      };

      w.addEventListener("pointerdown", onDown);
      w.addEventListener("pointermove", onMove);
      w.addEventListener("pointerup", onUp);
      w.addEventListener("pointercancel", onUp);
      w.addEventListener("pointerenter", () => { this.setActive(); this.resetIdleTimer(); });
    },

    // 吸附到最近的左右边缘
    snapToEdge: function () {
      const w = this.widgetEl;
      if (!w || !w.offsetParent) return;
      const parent = w.offsetParent;
      const currentLeft = w.offsetLeft;
      const midX = parent.clientWidth / 2;
      w.style.transition = "opacity 0.4s ease, left 0.25s cubic-bezier(0.2,0.9,0.3,1.1), right 0.25s cubic-bezier(0.2,0.9,0.3,1.1)";
      if (currentLeft + w.offsetWidth / 2 < midX) {
        w.style.left = "8px";
        w.style.right = "auto";
      } else {
        w.style.left = "auto";
        w.style.right = "8px";
      }
      setTimeout(() => { if (w) w.style.transition = "opacity 0.4s ease"; }, 280);
    },

    setActive: function () {
      const cfg = this.getConfig();
      this.isIdle = false;
      if (this.widgetEl) this.widgetEl.style.opacity = (cfg.opacity != null ? cfg.opacity : 1);
    },

    resetIdleTimer: function () {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.isIdle = true;
        if (this.widgetEl) this.widgetEl.style.opacity = IDLE_OPACITY;
      }, IDLE_TIMEOUT);
    },

    // ===== 展开卡片 =====
    toggleCard: function () {
      if (this.cardEl && this.cardEl.classList.contains("active")) { this.closeCard(); return; }
      this.openCard();
    },

    openCard: function () {
      const cfg = this.getConfig();
      let card = this.cardEl;
      if (!card) {
        card = document.createElement("div");
        card.id = "floating-widget-card";
        card.style.cssText = "position:fixed; z-index:100000; width:260px; max-height:360px; background:#fff; border-radius:14px; box-shadow:0 8px 30px rgba(15,23,42,0.25); overflow:hidden; display:flex; flex-direction:column; opacity:0; transform:scale(0.9); transform-origin:bottom right; transition:opacity 0.2s ease, transform 0.2s cubic-bezier(0.2,0.9,0.3,1.2); pointer-events:none;";
        // 卡片挂到 body（fixed 定位，不依赖父容器）
        document.body.appendChild(card);
        this.cardEl = card;
        // 点击卡片外部关闭
        setTimeout(() => {
          document.addEventListener("pointerdown", this._outsideHandler = (ev) => {
            if (card.classList.contains("active") && !card.contains(ev.target) && ev.target !== this.widgetEl && !this.widgetEl.contains(ev.target)) this.closeCard();
          });
        }, 50);
      }

      card.innerHTML = this.buildCardHTML();
      this.positionCard();
      card.style.opacity = "1";
      card.style.transform = "scale(1)";
      card.style.pointerEvents = "auto";
      card.classList.add("active");
      this.bindCardEvents();
      this.refreshApiInfo();
    },

    closeCard: function () {
      if (!this.cardEl) return;
      this.cardEl.style.opacity = "0";
      this.cardEl.style.transform = "scale(0.9)";
      this.cardEl.style.pointerEvents = "none";
      this.cardEl.classList.remove("active");
    },

    positionCard: function () {
      const w = this.widgetEl, card = this.cardEl;
      if (!w || !card) return;
      // 用 getBoundingClientRect（fixed 定位下 offsetLeft/offsetParent 不可靠）
      const wRect = w.getBoundingClientRect();
      if (!wRect || wRect.width === 0) return;
      const cardW = 260;
      const cardH = card.offsetHeight || 360;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 水平：靠悬浮窗所在边，但不溢出屏幕
      let left = wRect.left;
      if (wRect.left + wRect.width / 2 > vw / 2) {
        // 悬浮窗在右侧 → 卡片右对齐到悬浮窗右边
        left = wRect.right - cardW;
      } else {
        left = wRect.left;
      }
      left = Math.max(8, Math.min(left, vw - cardW - 8));
      // 垂直：优先显示在悬浮窗上方
      let top = wRect.top - cardH - 8;
      if (top < 8) top = wRect.bottom + 8; // 上方放不下则放下方
      if (top + cardH > vh - 8) top = Math.max(8, vh - cardH - 8); // 下方也放不下则居中靠上
      card.style.left = left + "px";
      card.style.top = top + "px";
      card.style.right = "auto";
      card.style.bottom = "auto";
    },

    buildCardHTML: function () {
      const cfg = this.getConfig();
      const apiInfo = this._lastApiInfo;
      const apiBlock = apiInfo
        ? '<div style="font-size:11px; color:#475569; line-height:1.7;">' +
          '<div>输入 token：<b style="color:#6366f1;">' + (apiInfo.inputTokens || 0) + '</b></div>' +
          '<div>输出 token：<b style="color:#6366f1;">' + (apiInfo.outputTokens || 0) + '</b></div>' +
          (apiInfo.totalTokens ? '<div>合计：<b>' + apiInfo.totalTokens + '</b></div>' : '') +
          '<div style="color:#94a3b8; font-size:10px;">' + (apiInfo.model || '未知模型') + ' · ' + this.formatTime(apiInfo.time) + '</div>' +
          '</div>'
        : '<div style="font-size:11px; color:#94a3b8; text-align:center; padding:12px 0;">暂无调用记录</div>';

      const errs = this._errorLog.slice(-3).reverse();
      const errBlock = errs.length > 0
        ? errs.map(e => '<div style="font-size:10px; color:#ef4444; line-height:1.5; padding:4px 0; border-bottom:1px dashed #fee2e2;"><div style="color:#94a3b8;">' + this.formatTime(e.time) + '</div>' + this.escapeHtml(e.message) + '</div>').join("")
        : '<div style="font-size:11px; color:#94a3b8; text-align:center; padding:6px 0;">无报错</div>';

      return '' +
        '<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; padding:10px 12px; display:flex; align-items:center; justify-content:space-between;">' +
          '<span style="font-size:13px; font-weight:700;">悬浮窗</span>' +
          '<button id="fw-card-close" style="background:rgba(255,255,255,0.2); border:none; color:#fff; width:22px; height:22px; border-radius:50%; cursor:pointer; font-size:14px; line-height:1;">×</button>' +
        '</div>' +
        '<div id="fw-card-tabs" style="display:flex; border-bottom:1px solid #e2e8f0;">' +
          '<button class="fw-tab-btn active" data-tab="api" style="flex:1; padding:8px; background:none; border:none; font-size:12px; font-weight:600; color:#6366f1; border-bottom:2px solid #6366f1; cursor:pointer;">API</button>' +
          '<button class="fw-tab-btn" data-tab="entries" style="flex:1; padding:8px; background:none; border:none; font-size:12px; font-weight:600; color:#64748b; cursor:pointer;">快捷入口</button>' +
        '</div>' +
        '<div id="fw-card-api" style="padding:12px; overflow-y:auto; flex:1;">' +
          '<div style="font-size:11px; color:#64748b; margin-bottom:6px;">当前 API 预设</div>' +
          '<div id="fw-card-preset" style="font-size:12px; font-weight:600; color:#1f2937; margin-bottom:8px;">加载中…</div>' +
          '<select id="fw-card-preset-select" style="width:100%; padding:6px 8px; border:1px solid #e2e8f0; border-radius:8px; font-size:12px; margin-bottom:10px;"></select>' +
          '<div style="font-size:11px; color:#64748b; margin-bottom:4px; margin-top:8px; border-top:1px solid #f1f5f9; padding-top:8px;">最新一轮调用</div>' +
          apiBlock +
          '<div style="font-size:11px; color:#64748b; margin-bottom:4px; margin-top:10px;">报错日志</div>' +
          errBlock +
        '</div>' +
        '<div id="fw-card-entries" style="padding:8px; overflow-y:auto; flex:1; display:none;">' +
          '<div id="fw-card-entries-list"></div>' +
        '</div>';
    },

    bindCardEvents: function () {
      const card = this.cardEl;
      if (!card) return;
      const closeBtn = card.querySelector("#fw-card-close");
      if (closeBtn) closeBtn.onclick = () => this.closeCard();
      // tab 切换
      card.querySelectorAll(".fw-tab-btn").forEach(btn => {
        btn.onclick = () => {
          const tab = btn.getAttribute("data-tab");
          card.querySelectorAll(".fw-tab-btn").forEach(b => { b.classList.remove("active"); b.style.color = "#64748b"; b.style.borderBottom = "none"; });
          btn.classList.add("active"); btn.style.color = "#6366f1"; btn.style.borderBottom = "2px solid #6366f1";
          const apiP = card.querySelector("#fw-card-api");
          const entP = card.querySelector("#fw-card-entries");
          if (tab === "api") { apiP.style.display = ""; entP.style.display = "none"; }
          else { apiP.style.display = "none"; entP.style.display = ""; }
        };
      });
      // 预设切换
      const sel = card.querySelector("#fw-card-preset-select");
      if (sel) sel.onchange = async () => {
        const id = sel.value;
        if (id) { localStorage.setItem("global_api_preset_id", id); this.refreshApiInfo(); if (typeof showToast === "function") showToast("已切换 API 预设"); }
      };
      this.renderCardEntries();
    },

    renderCardEntries: function () {
      const cfg = this.getConfig();
      const list = this.cardEl ? this.cardEl.querySelector("#fw-card-entries-list") : null;
      if (!list) return;
      list.innerHTML = "";
      // 置顶：小助手入口（固定，不可更改/删除）
      const astBtn = document.createElement("button");
      astBtn.style.cssText = "width:100%; text-align:left; padding:10px 12px; background:linear-gradient(135deg,#eef2ff,#f5f3ff); border:1px solid #c7d2fe; border-radius:8px; font-size:13px; font-weight:600; color:#4f46e5; cursor:pointer; margin-bottom:8px; transition:background 0.15s; display:flex; align-items:center; gap:8px;";
      astBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 3-3v-1a3 3 0 0 0 0-6v-1a3 3 0 0 0-3-3V5a3 3 0 0 0-3-3z"/><circle cx="12" cy="12" r="3"/></svg><span>小助手</span>';
      astBtn.onmouseenter = () => astBtn.style.background = "linear-gradient(135deg,#e0e7ff,#ede9fe)";
      astBtn.onmouseleave = () => astBtn.style.background = "linear-gradient(135deg,#eef2ff,#f5f3ff)";
      astBtn.onclick = () => {
        // assistant-panel 是 win-chat 的子元素，必须先确保 win-chat 处于 active，
        // 否则 openPanel 后 focus() 会让 #desktop 自动滚动导致主页面上抬卡住。
        const chatWin = document.getElementById("win-chat");
        const chatActive = chatWin && chatWin.classList.contains("active");
        const doOpenPanel = () => {
          if (typeof window.AppAssistant !== "undefined" && typeof window.AppAssistant.openPanel === "function") {
            window.AppAssistant.openPanel();
          } else {
            const btn = document.getElementById("assistant-entry-btn");
            if (btn) btn.click();
          }
        };
        if (chatActive) {
          doOpenPanel();
        } else if (typeof window.openApp === "function") {
          window.openApp("chat");
          setTimeout(doOpenPanel, 250);
        } else {
          doOpenPanel();
        }
        this.closeCard();
      };
      list.appendChild(astBtn);
      // 用户配置的快捷入口
      if (cfg.entries.length === 0) {
        const tip = document.createElement("div");
        tip.style.cssText = "font-size:11px; color:#94a3b8; text-align:center; padding:12px 0;";
        tip.textContent = "未配置快捷入口，请在设置-悬浮窗中添加";
        list.appendChild(tip);
        return;
      }
      cfg.entries.forEach(entry => {
        const btn = document.createElement("button");
        btn.style.cssText = "width:100%; text-align:left; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; color:#1f2937; cursor:pointer; margin-bottom:6px; transition:background 0.15s;";
        btn.textContent = entry.label || "未命名";
        btn.onmouseenter = () => btn.style.background = "#eef2ff";
        btn.onmouseleave = () => btn.style.background = "#f8fafc";
        btn.onclick = () => { this.navigateTo(entry); this.closeCard(); };
        list.appendChild(btn);
      });
    },

    navigateTo: function (entry) {
      if (entry.special === "settings-api") {
        if (typeof window.openApp === "function") window.openApp("settings");
        setTimeout(() => { if (typeof window.openSettingsLv2 === "function") window.openSettingsLv2("api"); }, 300);
      } else if (entry.special === "settings-data") {
        if (typeof window.openApp === "function") window.openApp("settings");
        setTimeout(() => { if (typeof window.openSettingsLv2 === "function") window.openSettingsLv2("data"); }, 300);
      } else if (entry.appId) {
        if (typeof window.openApp === "function") window.openApp(entry.appId);
        else if (typeof openApp === "function") openApp(entry.appId);
      }
    },

    // ===== API 信息与报错 =====
    refreshApiInfo: async function () {
      const card = this.cardEl;
      if (!card) return;
      const nameEl = card.querySelector("#fw-card-preset");
      const selEl = card.querySelector("#fw-card-preset-select");
      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        let presets = [];
        try { presets = await db.api_presets.toArray(); } catch (e) {}
        if (selEl) {
          selEl.innerHTML = "";
          presets.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id; opt.textContent = p.name || ("预设 " + p.id);
            if (String(p.id) === String(presetId)) opt.selected = true;
            selEl.appendChild(opt);
          });
          if (presets.length === 0) { const opt = document.createElement("option"); opt.textContent = "暂无预设"; opt.disabled = true; selEl.appendChild(opt); }
        }
        if (nameEl) {
          const cur = presets.find(p => String(p.id) === String(presetId));
          nameEl.textContent = cur ? (cur.name + " · " + (cur.model || "未知模型")) : (presets.length === 0 ? "未配置任何预设" : "未选择预设");
        }
      } catch (e) { if (nameEl) nameEl.textContent = "读取失败"; }
    },

    // 供 API 调用方挂接：记录最新一轮 token 用量
    recordApiUsage: function (usage, model) {
      if (!usage) return;
      try {
        this._lastApiInfo = {
          inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
          outputTokens: usage.completion_tokens || usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          model: model || "未知模型",
          time: Date.now()
        };
        // 若卡片正打开，实时刷新
        if (this.cardEl && this.cardEl.classList.contains("active")) {
          const apiP = this.cardEl.querySelector("#fw-card-api");
          if (apiP && apiP.style.display !== "none") {
            // 仅更新 token 区，避免重渲染整个卡片
            const info = this._lastApiInfo;
            let block = apiP.querySelector("[data-info]");
            if (!block) {
              // 简单重渲染整个卡片以保持一致
              this.cardEl.innerHTML = this.buildCardHTML();
              this.bindCardEvents();
              this.refreshApiInfo();
            }
          }
        }
      } catch (e) {}
    },

    // 供 API 调用方挂接：记录报错
    recordApiError: function (err) {
      try {
        const msg = (err && err.message) ? err.message : String(err);
        this._errorLog.push({ time: Date.now(), message: msg });
        if (this._errorLog.length > 20) this._errorLog = this._errorLog.slice(-20);
        if (this.cardEl && this.cardEl.classList.contains("active")) {
          this.cardEl.innerHTML = this.buildCardHTML();
          this.bindCardEvents();
          this.refreshApiInfo();
        }
      } catch (e) {}
    },

    formatTime: function (t) {
      if (!t) return "";
      const d = new Date(t);
      const pad = (n) => (n < 10 ? "0" + n : n);
      return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    },

    escapeHtml: function (s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },

    // ===== 初始化 =====
    init: function () {
      const cfg = this.getConfig();
      if (cfg.enabled) this.mountWidget();
      // v1.5.20：预热破限世界书缓存与预设索引（异步，失败静默）
      try {
        if (typeof window.refreshJailbreakCache === 'function') window.refreshJailbreakCache();
        if (typeof window.rebuildJailbreakPresetIndex === 'function') window.rebuildJailbreakPresetIndex();
      } catch (e) {}
    }
  };

  window.floatingWidgetSystem = floatingWidgetSystem;

  // 全局安全钩子：供 app_chat / app_assistant / 其他模块挂接 token 用量与报错
  // 即使悬浮窗模块未加载也不会报错（静默 no-op）
  window.fwTrackUsage = function (usage, model) {
    try {
      if (window.floatingWidgetSystem && typeof window.floatingWidgetSystem.recordApiUsage === "function") {
        window.floatingWidgetSystem.recordApiUsage(usage, model);
      }
    } catch (e) {}
  };
  window.fwTrackError = function (err) {
    try {
      if (window.floatingWidgetSystem && typeof window.floatingWidgetSystem.recordApiError === "function") {
        window.floatingWidgetSystem.recordApiError(err);
      }
    } catch (e) {}
  };

  // ============================================================
  //  破限世界书 · 全局下沉注入（v1.5.20）
  //
  //  背景：破限分组的世界书是用来让模型突破安全限制的。以前只有"主聊天"通过
  //  worldBookEngine 挂载，其余 40 多处直接 fetch(`${api.url}/chat/completions`)
  //  的调用（总结/翻译/心声/朋友圈/反查/深谈/桌宠/小剧场/工作台…）**完全没有破限内容**，
  //  于是"有的地方破限成功、有的地方失败"。
  //
  //  做法：在 window.fetch 这一层做一次性拦截——
  //    · 任何 POST 到 */chat/completions 的请求，只要带 messages，就按该 api 预设
  //      的 jailbreakEntryIds 把破限世界书塞为**最高优先级的首条 system 消息**；
  //    · 所有调用方（含流式、含 fwTrackedFetch、含用户自定义脚本）都自动获得破限，
  //      不需要逐个改动 40 多处调用点；
  //    · 没配置 / 内容为空 / 已经注入过 → 完全不动请求体，保证零副作用。
  // ============================================================
  var JAILBREAK_SEP = "\n\n==================== 以下为最高优先级强制设定（优先于其后所有内容） ====================\n";

  window.__jailbreakCache = window.__jailbreakCache || { byId: {}, loadedAt: 0 };

  window.refreshJailbreakCache = async function () {
    try {
      var list = await db.world_book_entries.toArray();
      var byId = {};
      (list || []).forEach(function (e) {
        if (e && e.id != null) byId[String(e.id)] = { title: e.title || '', content: e.content || '', group: e.group || '' };
      });
      window.__jailbreakCache.byId = byId;
      window.__jailbreakCache.loadedAt = Date.now();
    } catch (e) {
      console.warn('[破限] 世界书缓存刷新失败:', e);
    }
  };

  // 若 api 预设 id 未知（部分调用只传了 url），按 url+model 回退到当前全局预设
  window.resolveJailbreakEntryIds = function (api) {
    try {
      if (api && Array.isArray(api.jailbreakEntryIds)) return api.jailbreakEntryIds;
      if (api && api.jailbreakEntryId != null) return [api.jailbreakEntryId];
      var globalId = localStorage.getItem('global_api_preset_id');
      if (!globalId || !api) return [];
      var base = (api.url || '').replace(/\/+$/, '');
      var match = window.__jailbreakPresetIndex && window.__jailbreakPresetIndex[base + '|' + (api.model || '')];
      if (match) return match.ids || [];
    } catch (e) {}
    return [];
  };

  // 把破限内容拼进请求体（原地修改，返回是否发生了注入）
  window.injectJailbreakIntoBody = function (api, body) {
    try {
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return false;
      var ids = window.resolveJailbreakEntryIds(api);
      if (!ids || ids.length === 0) return false;
      var cache = window.__jailbreakCache.byId || {};
      var blocks = [];
      ids.forEach(function (id) {
        var e = cache[String(id)];
        if (e && e.content && String(e.content).trim()) {
          blocks.push('【' + (e.title || '破限设定') + '】\n' + e.content);
        }
      });
      if (blocks.length === 0) return false;
      var text = blocks.join('\n\n');
      // 已经注入过就不重复（流式重试 / 同体复用场景）
      if (body.messages[0] && typeof body.messages[0].content === 'string' && body.messages[0].content.indexOf('最高优先级强制设定') >= 0) return false;

      var first = body.messages[0];
      if (first && first.role === 'system' && typeof first.content === 'string') {
        // 与首条 system 合并成一条，保证破限排在整个上下文最前面
        first.content = text + JAILBREAK_SEP + first.content;
      } else {
        body.messages.unshift({ role: 'system', content: text });
      }
      body.__jailbreakInjected = true;
      return true;
    } catch (e) {
      console.warn('[破限] 注入失败（已跳过，不影响请求）:', e);
      return false;
    }
  };

  // 全局 fetch 拦截：覆盖全部调用点（流式 / 非流式 / 追踪器 / 自定义脚本）
  if (!window.__jailbreakFetchPatched) {
    window.__jailbreakFetchPatched = true;
    var __origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && url.indexOf('/chat/completions') !== -1 && init && typeof init.body === 'string') {
          var body = JSON.parse(init.body);
          if (body && Array.isArray(body.messages)) {
            var api = window.__jailbreakApiByUrl ? window.__jailbreakApiByUrl(url, body.model) : null;
            var injected = window.injectJailbreakIntoBody(api, body);
            if (injected) {
              init = Object.assign({}, init, { body: JSON.stringify(body) });
            }
          }
        }
      } catch (e) {
        // 任何解析异常都退回原始请求，绝不因为破限注入而让请求失败
      }
      return __origFetch(input, init);
    };
  }

  // 预设索引：url+model → { ids }，供"只拿到 url 的调用点"回退匹配
  window.rebuildJailbreakPresetIndex = async function () {
    try {
      var presets = await db.api_presets.toArray();
      var idx = {};
      (presets || []).forEach(function (p) {
        var base = (p.url || '').replace(/\/+$/, '');
        idx[base + '|' + (p.model || '')] = { ids: p.jailbreakEntryIds || [], name: p.name || '' };
      });
      window.__jailbreakPresetIndex = idx;
      window.__jailbreakApiByUrl = function (url, model) {
        try {
          var base = url.replace(/\/chat\/completions.*$/, '').replace(/\/+$/, '');
          var hit = idx[base + '|' + (model || '')];
          if (hit) return { url: base, model: model, jailbreakEntryIds: hit.ids };
          // 退一步：只按 url 匹配
          var found = null;
          Object.keys(idx).forEach(function (k) {
            if (found) return;
            if (k.split('|')[0] === base && idx[k].ids && idx[k].ids.length > 0) found = { url: base, model: model, jailbreakEntryIds: idx[k].ids };
          });
          return found;
        } catch (e) { return null; }
      };
    } catch (e) {
      console.warn('[破限] 预设索引构建失败:', e);
    }
  };

  // 全局集中式 LLM 调用追踪器：任何模块调用大模型 API 时均可使用此函数，
  // 自动将 token 用量与报错纳入悬浮窗监控，无需各模块重复编写 fwTrack 逻辑。
  // 参数：
  //   api      - API 预设对象（含 url/key/model/temperature 等）
  //   body     - 请求体对象（含 model/messages/temperature 等）
  //   opts     - 可选配置 { stream?: boolean, signal?: AbortSignal, parseJson?: boolean }
  // 返回：fetch 的 Response 对象（调用方自行处理流式或 JSON 解析）
  window.fwTrackedFetch = async function (api, body, opts) {
    const model = (body && body.model) || (api && api.model) || "unknown";
    const url = (api && api.url) || "";
    const fullUrl = url.endsWith("/") ? url.replace(/\/+$/, "") : url;
    const endpoint = body && body.messages ? "/chat/completions"
      : body && body.input ? "/v1/embeddings"
      : body && body.prompt ? "/images/generations"
      : "/chat/completions";

    // 破限世界书：作为下沉注入（fetch 拦截也会兜一次，这里显式做是为了让调用 api 对象的路径最快命中）
    if (endpoint === "/chat/completions" && body && Array.isArray(body.messages)) {
      window.injectJailbreakIntoBody(api, body);
    }

    let response;
    try {
      response = await fetch(fullUrl + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${api.key}`
        },
        body: JSON.stringify(body),
        signal: opts && opts.signal
      });
    } catch (netErr) {
      try { if (typeof window.fwTrackError === "function") window.fwTrackError(netErr); } catch (_) {}
      throw netErr;
    }

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} ${response.statusText}`);
      try { if (typeof window.fwTrackError === "function") window.fwTrackError(err); } catch (_) {}
      return response;
    }

    // 非流式响应：克隆后解析 usage 并上报
    if (!opts || !opts.stream) {
      try {
        const cloned = response.clone();
        const data = await cloned.json();
        if (data && data.usage && typeof window.fwTrackUsage === "function") {
          window.fwTrackUsage(data.usage, model);
        }
      } catch (_) {}
    }

    return response;
  };

  // 便捷版：直接返回解析后的 JSON（适用于非流式 chat completions）
  // 自动提取 choices[0].message.content 并上报 usage
  window.fwCallLLM = async function (api, messages, opts) {
    const body = {
      model: api.model,
      messages: messages,
      temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : (api.temperature || 0.7)
    };
    if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;

    const response = await window.fwTrackedFetch(api, body, { stream: false });
    if (!response.ok) {
      throw new Error(`大模型交互响应失败: HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
  };

  // DOM 就绪后初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => floatingWidgetSystem.init());
  } else {
    floatingWidgetSystem.init();
  }
})();
