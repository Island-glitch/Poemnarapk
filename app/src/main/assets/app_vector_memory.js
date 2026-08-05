/**
 * app_vector_memory.js - 向量化记忆设置面板与 Embedding 模型来源管理
 *
 * 设计目标：
 *  1. 将「向量化记忆」从 API 协议设置中独立出来，置于 TTS 语音设置之下。
 *  2. 支持两种向量来源：
 *     - 在线 Embedding API（OpenAI 兼容 /v1/embeddings）：填写 URL + APIKey，拉取模型，选择模型，测试连接，保存。
 *     - 本地 ONNX 大模型：不再默认下载，仅在用户主动开启并点击下载时才拉取并安装。
 *  3. 其他向量检索逻辑（topk / 衰减 / 阈值 / 三角重心）保持不变，仍由 app_summary_memory.js 负责。
 *
 * LocalStorage 键约定：
 *  - settings-vector-enabled : "true"/"false"  向量化记忆总开关（沿用旧键，平滑迁移）
 *  - vector-source           : "online"/"local" 向量来源
 *  - vector-api-url          : 在线 Embedding 接口基础 URL（如 https://api.openai.com/v1）
 *  - vector-api-key          : 在线 Embedding API Key
 *  - vector-api-model        : 选中的在线模型 id
 */
(function () {
  "use strict";

  function getConfig() {
    return {
      enabled: localStorage.getItem("settings-vector-enabled") === "true",
      source: localStorage.getItem("vector-source") || "online",
      apiUrl: localStorage.getItem("vector-api-url") || "",
      apiKey: localStorage.getItem("vector-api-key") || "",
      model: localStorage.getItem("vector-api-model") || ""
    };
  }

  function saveConfig(cfg) {
    localStorage.setItem("settings-vector-enabled", cfg.enabled ? "true" : "false");
    localStorage.setItem("vector-source", cfg.source || "online");
    localStorage.setItem("vector-api-url", cfg.apiUrl || "");
    localStorage.setItem("vector-api-key", cfg.apiKey || "");
    localStorage.setItem("vector-api-model", cfg.model || "");
  }

  /**
   * 将用户输入的 URL 规整为 /v1/embeddings 完整端点。
   * 兼容：https://api.openai.com/v1 / https://api.openai.com/v1/ / .../embeddings / .../v1
   */
  function resolveEmbeddingsEndpoint(baseUrl) {
    let url = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!url) return "";
    if (/\/embeddings$/.test(url)) return url;
    if (/\/v1$/.test(url)) return url + "/embeddings";
    if (/\/v\d+$/.test(url)) return url + "/embeddings";
    // 既无 /v1 也无 /embeddings：默认补 /v1/embeddings
    return url + "/v1/embeddings";
  }

  function resolveModelsEndpoint(baseUrl) {
    let url = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!url) return "";
    if (/\/models$/.test(url)) return url;
    if (/\/v1$/.test(url)) return url + "/models";
    if (/\/v\d+$/.test(url)) return url + "/models";
    return url + "/v1/models";
  }

  const vectorMemorySystem = {
    /**
     * 向量化记忆设置面板 HTML 模板（由 app_router.js 懒注入到设置二级面板）。
     */
    getPanelHTML: function () {
      return `
        <div id="settings-lv2-vector-memory" class="settings-lv2-panel" style="display:none;">
          <!-- 0. 总开关 -->
          <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; background:var(--surface); padding:12px; border-radius:12px; border:1px solid var(--border);">
            <div>
              <label style="margin-bottom:0; font-weight:700;">开启向量化记忆检索</label>
              <div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">关闭后将退化为关键词模糊匹配，不再生成向量。</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="vm-enabled-toggle">
              <span class="slider"></span>
            </label>
          </div>

          <!-- 1. 向量来源选择 -->
          <div class="form-group">
            <label>向量来源</label>
            <select id="vm-source-select">
              <option value="online">在线 Embedding API（推荐，网页版可用）</option>
              <option value="local">本地 ONNX 向量大模型（需主动下载）</option>
            </select>
          </div>

          <!-- 2. 在线 Embedding API 配置区 -->
          <div id="vm-online-section" style="display:none;">
            <div class="form-group">
              <label>接口基础 URL</label>
              <input type="text" id="vm-api-url" placeholder="例如 https://api.openai.com/v1">
              <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">填到 /v1 即可，系统会自动拼接 /embeddings 与 /models。兼容 OpenAI 协议。</div>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <input type="password" id="vm-api-key" placeholder="sk-...">
            </div>
            <div class="form-group">
              <label>模型选择</label>
              <div class="model-row">
                <select id="vm-model-select"><option value="">请先拉取模型</option></select>
                <button id="btn-vm-fetch-models" class="btn">拉取模型</button>
              </div>
            </div>
            <div class="form-actions">
              <button id="btn-vm-test-online" class="btn btn-outline">测试连接</button>
              <button id="btn-vm-save-online" class="btn btn-primary">保存配置</button>
            </div>
          </div>

          <!-- 3. 本地 ONNX 模型区 -->
          <div id="vm-local-section" style="display:none;">
            <div class="form-group" style="background:#fffbeb; padding:12px; border-radius:12px; border:1px solid #fde68a;">
              <label style="font-weight:700; color:#92400e; display:block; margin-bottom:6px;">本地向量大模型管理</label>
              <div id="vm-local-status" style="font-size:11px; color:#92400e; margin-bottom:10px;">正在检测本地模型状态…</div>
              <!-- 下载进度条 -->
              <div id="vm-download-progress-wrap" style="display:none; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:10px; color:#92400e; margin-bottom:4px;">
                  <span id="vm-download-stage">准备下载…</span>
                  <span id="vm-download-percent">0%</span>
                </div>
                <div style="width:100%; height:8px; background:#fde68a; border-radius:4px; overflow:hidden;">
                  <div id="vm-download-bar" style="width:0%; height:100%; background:#d97706; transition:width 0.3s ease;"></div>
                </div>
                <div id="vm-download-size" style="font-size:9px; color:#a16207; margin-top:3px;"></div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="btn-vm-download-local" class="btn btn-primary" style="font-size:12px;">下载本地向量大模型</button>
                <button id="btn-vm-check-local" class="btn btn-outline" style="font-size:12px;">刷新状态</button>
              </div>
              <div style="font-size:10px; color:#a16207; margin-top:8px; line-height:1.5;">
                · 本地模型约数十 MB，仅首次下载，安装至应用私有目录。<br>
                · 下载后即便断网也可继续生成向量。<br>
                · 仅在 APK 真机环境可用；网页版请使用在线 API。
              </div>
            </div>
            <div class="form-actions">
              <button id="btn-vm-save-local" class="btn btn-primary">保存配置</button>
            </div>
          </div>

          <!-- 4. 当前生效来源提示 -->
          <div class="form-group" style="background:var(--surface); padding:10px; border-radius:10px; border:1px solid var(--border); font-size:11px; color:var(--text-secondary);">
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">当前生效配置</div>
            <div id="vm-active-summary">—</div>
          </div>
        </div>
      `;
    },

    /**
     * 初始化设置面板：回填配置、绑定按钮。
     */
    initPanel: function () {
      const toggle = document.getElementById("vm-enabled-toggle");
      if (!toggle) return; // 面板未注入
      const cfg = getConfig();

      toggle.checked = cfg.enabled;
      const sourceSel = document.getElementById("vm-source-select");
      if (sourceSel) sourceSel.value = cfg.source || "online";

      const urlEl = document.getElementById("vm-api-url");
      if (urlEl) urlEl.value = cfg.apiUrl || "";
      const keyEl = document.getElementById("vm-api-key");
      if (keyEl) keyEl.value = cfg.apiKey || "";

      // 回填模型下拉
      const sel = document.getElementById("vm-model-select");
      if (cfg.model && sel) {
        sel.innerHTML = `<option value="${cfg.model}" selected>${cfg.model}</option>`;
      }

      this._refreshSectionVisibility(cfg.source || "online");
      this._refreshActiveSummary();
      this._refreshLocalStatus();

      // 绑定事件
      toggle.onchange = (e) => {
        localStorage.setItem("settings-vector-enabled", e.target.checked ? "true" : "false");
        this._refreshActiveSummary();
        showToast(e.target.checked ? "已开启向量化记忆检索" : "已关闭向量化记忆检索");
      };

      if (sourceSel) {
        sourceSel.onchange = (e) => {
          this._refreshSectionVisibility(e.target.value);
          this._refreshActiveSummary();
        };
      }

      const btnFetch = document.getElementById("btn-vm-fetch-models");
      if (btnFetch) btnFetch.onclick = () => this.fetchModels();
      const btnTest = document.getElementById("btn-vm-test-online");
      if (btnTest) btnTest.onclick = () => this.testOnlineConnection();
      const btnSaveOnline = document.getElementById("btn-vm-save-online");
      if (btnSaveOnline) btnSaveOnline.onclick = () => this.saveOnlineConfig();
      const btnSaveLocal = document.getElementById("btn-vm-save-local");
      if (btnSaveLocal) btnSaveLocal.onclick = () => this.saveLocalConfig();
      const btnDownload = document.getElementById("btn-vm-download-local");
      if (btnDownload) btnDownload.onclick = () => this.downloadLocalModel();
      const btnCheck = document.getElementById("btn-vm-check-local");
      if (btnCheck) btnCheck.onclick = () => this._refreshLocalStatus();
    },

    _refreshSectionVisibility: function (source) {
      const online = document.getElementById("vm-online-section");
      const local = document.getElementById("vm-local-section");
      if (online) online.style.display = source === "online" ? "block" : "none";
      if (local) local.style.display = source === "local" ? "block" : "none";
    },

    _refreshActiveSummary: function () {
      const el = document.getElementById("vm-active-summary");
      if (!el) return;
      const cfg = getConfig();
      if (!cfg.enabled) {
        el.innerHTML = "向量化记忆：<b style='color:#dc2626;'>已关闭</b>（使用关键词模糊匹配）";
        return;
      }
      if (cfg.source === "online") {
        const urlOk = cfg.apiUrl ? "已配置" : "<span style='color:#dc2626;'>未配置 URL</span>";
        const keyOk = cfg.apiKey ? "已配置" : "<span style='color:#dc2626;'>未配置 Key</span>";
        const modelOk = cfg.model ? cfg.model : "<span style='color:#ca8a04;'>未选择模型</span>";
        el.innerHTML = `来源：<b>在线 API</b> · URL：${urlOk} · Key：${keyOk} · 模型：${modelOk}`;
      } else {
        el.innerHTML = `来源：<b>本地 ONNX 模型</b>（仅在 APK 真机环境可用）`;
      }
    },

    /**
     * 拉取在线 Embedding 模型清单（OpenAI 兼容 GET /v1/models）。
     */
    fetchModels: async function () {
      const baseUrl = document.getElementById("vm-api-url").value.trim();
      const apiKey = document.getElementById("vm-api-key").value.trim();
      if (!baseUrl || !apiKey) {
        showToast("请先填写接口 URL 与 API Key");
        return;
      }
      const sel = document.getElementById("vm-model-select");
      if (sel) sel.innerHTML = `<option value="">拉取中…</option>`;
      try {
        const endpoint = resolveModelsEndpoint(baseUrl);
        const resp = await fetch(endpoint, {
          method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
        if (!list.length) throw new Error("返回的模型列表为空");
        // 优先展示疑似 embedding 模型
        const embedLike = list.filter(m => /embed|embedding|e5|bge|m3/i.test(m.id || m));
        const ordered = embedLike.length ? embedLike : list;
        const saved = getConfig().model;
        if (sel) {
          sel.innerHTML = ordered.map(m => {
            const id = typeof m === "string" ? m : (m.id || m.name);
            const flag = id === saved ? " selected" : "";
            return `<option value="${id}"${flag}>${id}</option>`;
          }).join("");
        }
        showToast(`已拉取 ${ordered.length} 个模型（共 ${list.length} 个）`);
      } catch (err) {
        console.error("拉取向量模型失败:", err);
        if (sel) sel.innerHTML = `<option value="">拉取失败，请检查 URL 与 Key</option>`;
        showToast("拉取模型失败：" + err.message);
      }
    },

    /**
     * 测试在线 Embedding 连接（发起一次最小 embedding 请求）。
     */
    testOnlineConnection: async function () {
      const baseUrl = document.getElementById("vm-api-url").value.trim();
      const apiKey = document.getElementById("vm-api-key").value.trim();
      const model = document.getElementById("vm-model-select").value;
      if (!baseUrl || !apiKey) {
        showToast("请先填写接口 URL 与 API Key");
        return;
      }
      if (!model) {
        showToast("请先拉取并选择一个模型");
        return;
      }
      showToast("正在测试 Embedding 连接…");
      try {
        const endpoint = resolveEmbeddingsEndpoint(baseUrl);
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({ model: model, input: "测试向量连接" })
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        const vec = data.data ? data.data[0].embedding : data.embedding;
        if (!vec || !vec.length) throw new Error("返回的向量数据为空");
        showToast(`连接成功！向量维度：${vec.length}`);
      } catch (err) {
        console.error("在线 Embedding 连接测试失败:", err);
        showToast("连接测试失败：" + err.message);
      }
    },

    saveOnlineConfig: function () {
      const cfg = getConfig();
      cfg.enabled = document.getElementById("vm-enabled-toggle").checked;
      cfg.source = "online";
      cfg.apiUrl = document.getElementById("vm-api-url").value.trim();
      cfg.apiKey = document.getElementById("vm-api-key").value.trim();
      cfg.model = document.getElementById("vm-model-select").value;
      saveConfig(cfg);
      // 同步来源下拉
      const sourceSel = document.getElementById("vm-source-select");
      if (sourceSel) sourceSel.value = "online";
      this._refreshSectionVisibility("online");
      this._refreshActiveSummary();
      showToast("在线 Embedding 配置已保存");
    },

    saveLocalConfig: function () {
      const cfg = getConfig();
      cfg.enabled = document.getElementById("vm-enabled-toggle").checked;
      cfg.source = "local";
      saveConfig(cfg);
      const sourceSel = document.getElementById("vm-source-select");
      if (sourceSel) sourceSel.value = "local";
      this._refreshSectionVisibility("local");
      this._refreshActiveSummary();
      showToast("本地模型配置已保存");
    },

    /**
     * 检测本地 ONNX 模型状态并刷新面板提示。
     */
    _refreshLocalStatus: function () {
      const statusEl = document.getElementById("vm-local-status");
      if (!statusEl) return;
      const btn = document.getElementById("btn-vm-download-local");
      // 非真机环境
      if (!(window.AndroidMCP && typeof window.AndroidMCP.isLocalEmbeddingModelReady === 'function')) {
        statusEl.innerHTML = "当前为网页环境，无法使用本地 ONNX 模型。请使用在线 Embedding API。";
        if (btn) btn.disabled = true;
        return;
      }
      try {
        const ready = window.AndroidMCP.isLocalEmbeddingModelReady();
        const isReady = ready === true || ready === "true" || ready === 1 || ready === "1";
        if (isReady) {
          statusEl.innerHTML = "本地向量大模型：<b style='color:#16a34a;'>已安装就绪</b>";
          if (btn) { btn.disabled = false; btn.innerText = "重新下载本地向量大模型"; }
        } else {
          statusEl.innerHTML = "本地向量大模型：<b style='color:#dc2626;'>未安装</b>（点击下方按钮主动下载）";
          if (btn) { btn.disabled = false; btn.innerText = "下载本地向量大模型"; }
        }
      } catch (e) {
        statusEl.innerHTML = "检测本地模型状态失败：" + e.message;
      }
    },

    /**
     * 主动下载本地 ONNX 向量大模型（仅在 APK 真机环境可用）。
     * 带实时进度条，由 Kotlin 通过 onEmbeddingModelDownloadProgress 回调驱动。
     */
    downloadLocalModel: function () {
      if (!(window.AndroidMCP && typeof window.AndroidMCP.downloadLocalEmbeddingModel === 'function')) {
        showToast("当前环境不支持下载本地模型，请在 APK 真机中使用");
        return;
      }
      showCustomConfirm(
        "下载本地向量大模型",
        "即将下载本地 ONNX 向量大模型（约数十 MB），下载完成后自动安装到应用私有目录。\n\n建议在 Wi-Fi 环境下进行，是否继续？",
        async () => {
          // 显示进度条
          this._showDownloadProgress("准备下载…", 0, 0, 0);
          const btn = document.getElementById("btn-vm-download-local");
          if (btn) btn.disabled = true;
          try {
            const ok = window.AndroidMCP.downloadLocalEmbeddingModel();
            if (ok === true || ok === "true" || ok === 1 || ok === "1") {
              this._showDownloadProgress("下载任务已启动…", 0, 0, 0);
            } else {
              this._hideDownloadProgress();
              if (btn) btn.disabled = false;
              showToast("本地模型下载启动失败，请检查网络或存储空间");
            }
          } catch (e) {
            this._hideDownloadProgress();
            if (btn) btn.disabled = false;
            console.error("下载本地向量大模型失败:", e);
            showToast("下载失败：" + e.message);
          }
        }
      );
    },

    /**
     * 显示下载进度（供 Kotlin 通过 onEmbeddingModelDownloadProgress 回调调用）。
     * @param {string} stage - 阶段描述：下载模型/下载词表/安装中/完成/失败
     * @param {number} percent - 0~100
     * @param {number} downloadedBytes - 已下载字节数
     * @param {number} totalBytes - 总字节数（未知为0）
     */
    _showDownloadProgress: function (stage, percent, downloadedBytes, totalBytes) {
      const wrap = document.getElementById("vm-download-progress-wrap");
      if (!wrap) return;
      wrap.style.display = "block";
      const stageEl = document.getElementById("vm-download-stage");
      const pctEl = document.getElementById("vm-download-percent");
      const barEl = document.getElementById("vm-download-bar");
      const sizeEl = document.getElementById("vm-download-size");
      if (stageEl) stageEl.innerText = stage || "下载中…";
      const pct = Math.max(0, Math.min(100, parseInt(percent) || 0));
      if (pctEl) pctEl.innerText = pct + "%";
      if (barEl) barEl.style.width = pct + "%";
      if (sizeEl) {
        const fmt = (b) => {
          if (!b) return "0B";
          if (b < 1024) return b + "B";
          if (b < 1024 * 1024) return (b / 1024).toFixed(1) + "KB";
          return (b / 1024 / 1024).toFixed(2) + "MB";
        };
        if (totalBytes > 0) {
          sizeEl.innerText = `${fmt(downloadedBytes)} / ${fmt(totalBytes)}`;
        } else if (downloadedBytes > 0) {
          sizeEl.innerText = `已下载 ${fmt(downloadedBytes)}`;
        }
      }
    },

    _hideDownloadProgress: function () {
      const wrap = document.getElementById("vm-download-progress-wrap");
      if (wrap) wrap.style.display = "none";
    }
  };

  /**
   * 全局下载进度回调入口：供 Kotlin DownloadThread 通过 evaluateJavascript 实时调用。
   * @param {string} stage - 阶段：downloading_model / downloading_vocab / installing / done / error
   * @param {number} percent - 0~100
   * @param {number} downloadedBytes
   * @param {number} totalBytes
   * @param {string} errorMsg - 仅 stage=error 时有值
   */
  window.onEmbeddingModelDownloadProgress = function (stage, percent, downloadedBytes, totalBytes, errorMsg) {
    const vms = window.vectorMemorySystem;
    if (!vms) return;
    const stageMap = {
      downloading_model: "下载 ONNX 模型中",
      downloading_vocab: "下载词表中",
      installing: "安装中…",
      done: "下载完成",
      error: "下载失败"
    };
    const stageText = stageMap[stage] || stage || "下载中…";
    vms._showDownloadProgress(stageText, percent, downloadedBytes, totalBytes);

    if (stage === "done") {
      const btn = document.getElementById("btn-vm-download-local");
      if (btn) { btn.disabled = false; btn.innerText = "重新下载本地向量大模型"; }
      showToast("本地向量大模型下载完成！");
      setTimeout(() => {
        vms._refreshLocalStatus();
        vms._hideDownloadProgress();
      }, 1500);
    } else if (stage === "error") {
      const btn = document.getElementById("btn-vm-download-local");
      if (btn) btn.disabled = false;
      showToast("下载失败：" + (errorMsg || "未知错误"));
      // 保留进度条和错误状态5秒后隐藏
      setTimeout(() => vms._hideDownloadProgress(), 5000);
    }
  };

  window.vectorMemorySystem = vectorMemorySystem;
})();
