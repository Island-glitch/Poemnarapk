/**
 * ============================================================
 * app_tts.js - 叙事诗小手机：MiniMax TTS 语音合成引擎
 * ------------------------------------------------------------
 * 职责：
 *   1. 提供 TTS 语音设置面板 HTML 模板与交互（个人id / groupid / key + 拉取模型）；
 *   2. 调用 MiniMax T2A v2 接口合成语音（hex 音频解码为 Blob）；
 *   3. 本地 IndexedDB 缓存生成的语音，3 天自动过期删除；
 *   4. 对话详情开启 TTS 后，点击语音消息即转换文字为语音并播放。
 *
 * 配置存储：localStorage("tts-config") -> { personalId, groupId, apiKey, model }
 * 语音缓存：独立 Dexie 库 TtsVoiceCacheDB.tts_cache { key, blob, createdAt, text, voiceId, model }
 * ============================================================
 */
(function () {
  "use strict";

  // MiniMax T2A 已知模型清单（官方文档枚举值）
  const MINIMAX_MODELS = [
    { id: "speech-02-hd", label: "speech-02-hd（高质量，节奏稳定）" },
    { id: "speech-02-turbo", label: "speech-02-turbo（多语种，速度优）" },
    { id: "speech-01-hd", label: "speech-01-hd（经典高清）" },
    { id: "speech-01-turbo", label: "speech-01-turbo（经典快速）" },
    { id: "speech-2.6-hd", label: "speech-2.6-hd（超低延迟）" },
    { id: "speech-2.6-turbo", label: "speech-2.6-turbo（代理优选）" },
    { id: "speech-2.8-hd", label: "speech-2.8-hd（超真实，含声音标签）" },
    { id: "speech-2.8-turbo", label: "speech-2.8-turbo（自然流畅）" }
  ];

  const CONFIG_KEY = "tts-config";
  const CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 天
  // 国内版 / 国际版默认接口地址（用户可在设置中自定义 URL 覆盖）
  const DEFAULT_URLS = {
    cn: "https://api.minimax.chat/v1/t2a_v2",
    intl: "https://api.minimaxi.com/v1/t2a_v2"
  };
  function resolveApiBaseUrl(cfg) {
    cfg = cfg || {};
    const custom = (cfg.customUrl || "").trim();
    if (custom) return custom.replace(/\/+$/, "");
    return (cfg.region === "intl" ? DEFAULT_URLS.intl : DEFAULT_URLS.cn);
  }

  // 独立语音缓存库，避免污染主库 schema
  let ttsDb = null;
  function getTtsDb() {
    if (ttsDb) return ttsDb;
    if (typeof Dexie === "undefined") return null;
    ttsDb = new Dexie("TtsVoiceCacheDB");
    ttsDb.version(1).stores({
      tts_cache: "key, createdAt"
    });
    return ttsDb;
  }

  // 简单稳定哈希（用于缓存 key，避免依赖外部库）
  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & h;
    }
    return (h >>> 0).toString(36);
  }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveConfig(cfg) {
    cfg = cfg || {};
    cfg.updatedAt = Date.now();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  function showToast(msg) {
    if (typeof window.showToast === "function") window.showToast(msg);
    else console.log("[TTS]", msg);
  }

  // hex 字符串 -> Blob
  function hexToBlob(hex, mime) {
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return new Blob([bytes], { type: mime || "audio/mpeg" });
  }

  const ttsSystem = {
    MINIMAX_MODELS: MINIMAX_MODELS,

    /**
     * TTS 语音设置面板 HTML 模板（由 app_router.js 懒注入到设置二级面板）。
     */
    getSettingsPanelHTML: function () {
      return `
        <div id="settings-lv2-tts" class="settings-lv2-panel" style="display:none;">
          <div class="form-group">
            <label>接口版本</label>
            <select id="tts-region-select">
              <option value="cn">国内版 (api.minimax.chat)</option>
              <option value="intl">国际版 (api.minimaxi.com)</option>
            </select>
          </div>
          <div class="form-group">
            <label>自定义接口 URL (留空则按上方版本自动填充)</label>
            <input type="text" id="tts-custom-url" placeholder="例如 https://api.minimax.chat/v1/t2a_v2">
          </div>
          <div class="form-group">
            <label>MiniMax 个人 ID</label>
            <input type="text" id="tts-personal-id" placeholder="个人 id">
          </div>
          <div class="form-group">
            <label>Group ID (必填，拼接在接口 URL)</label>
            <input type="text" id="tts-group-id" placeholder="例如 1234567890">
          </div>
          <div class="form-group">
            <label>API Key (必填)</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="password" id="tts-api-key" placeholder="MiniMax API Key" style="flex:1;">
              <button type="button" class="btn-copy-key" onclick="copyApiKey('tts-api-key')" title="复制 Key" style="width:36px; height:36px; border:1.5px solid var(--border); background:var(--surface); border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; padding:0;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary);"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>模型选择</label>
            <div class="model-row">
              <select id="tts-model-select"><option value="">请先拉取模型</option></select>
              <button id="btn-tts-fetch-models" class="btn">拉取</button>
            </div>
            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">拉取会校验 Group ID 与 Key，并载入 MiniMax T2A 可用模型清单。</div>
          </div>
          <div class="form-group" style="background: var(--surface); padding: 10px; border-radius: 10px; border: 1px solid var(--border); font-size:11px; color:var(--text-secondary);">
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">音色 ID 说明</div>
            在「聊天 - 对话详情」开启 TTS 后填写音色 ID（voice_id）。系统音色示例：
            <span style="color:var(--primary);">male-qn-jingying / female-yujie / female-tianmei / audiobook_female_1</span> 等。也可填写自行复刻的音色 ID。
          </div>
          <div class="form-actions">
            <button id="btn-tts-test" class="btn btn-outline">测试合成</button>
            <button id="btn-tts-save" class="btn btn-primary">保存配置</button>
          </div>
        </div>
      `;
    },

    /**
     * 初始化设置面板：回填配置、绑定按钮。
     */
    initSettingsPanel: function () {
      const personalEl = document.getElementById("tts-personal-id");
      if (!personalEl) return; // 面板未注入
      const cfg = getConfig();
      personalEl.value = cfg.personalId || "";
      document.getElementById("tts-group-id").value = cfg.groupId || "";
      document.getElementById("tts-api-key").value = cfg.apiKey || "";
      const regionSel = document.getElementById("tts-region-select");
      if (regionSel) regionSel.value = cfg.region === "intl" ? "intl" : "cn";
      const customUrlEl = document.getElementById("tts-custom-url");
      if (customUrlEl) customUrlEl.value = cfg.customUrl || "";

      // 回填模型下拉
      const sel = document.getElementById("tts-model-select");
      if (cfg.model && sel) {
        sel.innerHTML = MINIMAX_MODELS.map(m => `<option value="${m.id}"${m.id === cfg.model ? " selected" : ""}>${m.label}</option>`).join("");
      }

      const btnFetch = document.getElementById("btn-tts-fetch-models");
      if (btnFetch) btnFetch.onclick = () => ttsSystem.fetchModels();
      const btnTest = document.getElementById("btn-tts-test");
      if (btnTest) btnTest.onclick = () => ttsSystem.testSynthesize();
      const btnSave = document.getElementById("btn-tts-save");
      if (btnSave) btnSave.onclick = () => ttsSystem.saveFromForm();
    },

    /**
     * 拉取（校验凭据 + 载入模型清单）。
     * MiniMax T2A 无独立模型列表接口，故以最小合成请求校验凭据后载入已知模型。
     */
    fetchModels: async function () {
      const groupId = document.getElementById("tts-group-id").value.trim();
      const apiKey = document.getElementById("tts-api-key").value.trim();
      if (!groupId || !apiKey) {
        showToast("请先填写 Group ID 与 API Key");
        return;
      }
      const sel = document.getElementById("tts-model-select");
      if (sel) sel.innerHTML = '<option value="">校验中…</option>';
      showToast("正在校验 MiniMax 凭据…");
      try {
        const probe = await ttsSystem._callT2a({
          groupId: groupId,
          apiKey: apiKey,
          model: "speech-02-hd",
          text: "测",
          voiceId: "male-qn-jingying"
        });
        if (probe && probe.ok) {
          if (sel) {
            sel.innerHTML = MINIMAX_MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
            const cfg = getConfig();
            if (cfg.model) sel.value = cfg.model;
          }
          showToast("凭据校验通过，模型清单已载入");
        } else {
          if (sel) sel.innerHTML = '<option value="">校验失败</option>';
          showToast("凭据校验失败：" + (probe && probe.error ? probe.error : "未知错误"));
        }
      } catch (e) {
        if (sel) sel.innerHTML = '<option value="">校验失败</option>';
        showToast("网络异常：" + (e && e.message ? e.message : e));
      }
    },

    /**
     * 测试合成：用当前表单配置合成一句话并播放。
     */
    testSynthesize: async function () {
      const cfg = ttsSystem._readForm();
      if (!cfg.groupId || !cfg.apiKey) { showToast("请先填写并保存 Group ID 与 API Key"); return; }
      const model = (document.getElementById("tts-model-select").value) || "speech-02-hd";
      showToast("正在合成测试语音…");
      try {
        const blob = await ttsSystem.synthesize("你好，这是 TTS 语音测试。", "male-qn-jingying", {
          groupId: cfg.groupId, apiKey: cfg.apiKey, model: model,
          region: cfg.region, customUrl: cfg.customUrl
        });
        ttsSystem.playBlob(blob);
        showToast("测试语音已生成并播放");
      } catch (e) {
        showToast("合成失败：" + (e && e.message ? e.message : e));
      }
    },

    _readForm: function () {
      return {
        region: (document.getElementById("tts-region-select") || {}).value === "intl" ? "intl" : "cn",
        customUrl: (document.getElementById("tts-custom-url").value || "").trim(),
        personalId: (document.getElementById("tts-personal-id").value || "").trim(),
        groupId: (document.getElementById("tts-group-id").value || "").trim(),
        apiKey: (document.getElementById("tts-api-key").value || "").trim(),
        model: (document.getElementById("tts-model-select").value || "").trim()
      };
    },

    saveFromForm: function () {
      const cfg = ttsSystem._readForm();
      if (!cfg.groupId || !cfg.apiKey) { showToast("Group ID 与 API Key 不能为空"); return; }
      cfg.updatedAt = Date.now();
      saveConfig(cfg);
      showToast("TTS 语音配置已保存");
    },

    /**
     * 读取当前生效的 TTS 配置（设置页保存的）。
     */
    getActiveConfig: function () {
      return getConfig();
    },

    /**
     * 判断某会话是否启用 TTS。
     */
    isSessionTtsEnabled: function (sess) {
      return !!(sess && sess.ttsEnabled === 1);
    },

    /**
     * 调用 MiniMax T2A v2 接口。返回 { ok, blob, error, raw }
     */
    _callT2a: async function (opts) {
      const groupId = opts.groupId;
      const apiKey = opts.apiKey;
      const model = opts.model || "speech-02-hd";
      const text = opts.text || "";
      const voiceId = opts.voiceId || "male-qn-jingying";

      const baseCfg = { region: opts.region, customUrl: opts.customUrl };
      const baseUrl = opts.baseUrl || resolveApiBaseUrl(baseCfg);
      const url = baseUrl + "?GroupId=" + encodeURIComponent(groupId);
      const body = {
        model: model,
        text: text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        pronunciation_dict: { tone: [] }
      };

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
      } catch (netErr) {
        return { ok: false, error: "网络请求失败：" + (netErr && netErr.message ? netErr.message : netErr) };
      }

      if (!resp.ok) {
        let detail = "";
        try { detail = await resp.text(); } catch (e) {}
        return { ok: false, error: "HTTP " + resp.status + (detail ? " " + detail.slice(0, 120) : "") };
      }

      let json;
      try { json = await resp.json(); }
      catch (e) { return { ok: false, error: "响应解析失败" }; }

      const status = json && json.base_resp ? json.base_resp.status_code : undefined;
      if (status !== 0) {
        return { ok: false, error: (json && json.base_resp && json.base_resp.status_msg) || ("status_code=" + status) };
      }
      const hex = json && json.data ? json.data.audio : "";
      if (!hex) return { ok: false, error: "未返回音频数据" };
      const blob = hexToBlob(hex, "audio/mpeg");
      return { ok: true, blob: blob, raw: json };
    },

    /**
     * 合成语音（不经过缓存）。供测试/直接调用。
     */
    synthesize: async function (text, voiceId, opts) {
      opts = opts || {};
      const cfg = getConfig();
      const groupId = opts.groupId || cfg.groupId;
      const apiKey = opts.apiKey || cfg.apiKey;
      const model = opts.model || cfg.model || "speech-02-hd";
      const region = opts.region || cfg.region;
      const customUrl = opts.customUrl !== undefined ? opts.customUrl : cfg.customUrl;
      const res = await ttsSystem._callT2a({
        groupId: groupId, apiKey: apiKey, model: model, text: text, voiceId: voiceId,
        region: region, customUrl: customUrl
      });
      if (!res.ok) throw new Error(res.error || "合成失败");
      return res.blob;
    },

    /**
     * 判断给定文本是否对应一条已被收藏的语音消息。
     * 收藏的语音不受3天过期清理，可反复收听，仅手动移除收藏后才会被清理。
     */
    _isFavoritedVoiceText: async function (text) {
      if (!text || typeof db === "undefined" || !db) return false;
      try {
        const onlineHit = await db.messages
          .filter(m => m.isFavorite === 1 && m.contentType === 'voice')
          .toArray();
        for (let m of onlineHit) {
          try {
            const d = JSON.parse(m.content);
            if (d && d.text === text) return true;
          } catch (e) {}
        }
        const offlineHit = await db.offline_messages
          .filter(m => m.isFavorite === 1 && m.contentType === 'voice')
          .toArray();
        for (let m of offlineHit) {
          try {
            const d = JSON.parse(m.content);
            if (d && d.text === text) return true;
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    },

    /**
     * 缓存感知合成：命中本地缓存（3 天内）直接返回，否则合成并写入缓存。
     * 被收藏的语音即使过期也会保留缓存并直接返回，可反复收听。
     * @returns {Promise<Blob|null>} 失败时返回 null（已 showToast）
     */
    getOrSynthesize: async function (text, voiceId, sessionId) {
      const cfg = getConfig();
      if (!cfg.groupId || !cfg.apiKey) {
        showToast("TTS 未配置，请在设置中填写 MiniMax 凭据");
        return null;
      }
      const model = cfg.model || "speech-02-hd";
      const db = getTtsDb();
      const cacheKey = hashStr(model + "|" + voiceId + "|" + text);

      if (db) {
        try {
          const hit = await db.tts_cache.get(cacheKey);
          if (hit) {
            const isExpired = Date.now() - hit.createdAt >= CACHE_TTL;
            if (!isExpired) {
              return hit.blob;
            }
            // 过期：若该语音被收藏则保留缓存并直接返回（可反复收听），否则删除并重新合成
            const isFav = await ttsSystem._isFavoritedVoiceText(text);
            if (isFav) {
              return hit.blob;
            } else {
              await db.tts_cache.delete(cacheKey);
            }
          }
        } catch (e) { /* 缓存读失败则继续合成 */ }
      }

      try {
        const blob = await ttsSystem.synthesize(text, voiceId, { model: model });
        if (db) {
          try {
            await db.tts_cache.put({
              key: cacheKey, blob: blob, createdAt: Date.now(),
              text: text, voiceId: voiceId, model: model, sessionId: sessionId || null
            });
          } catch (e) { /* 缓存写失败不影响播放 */ }
        }
        return blob;
      } catch (e) {
        showToast("语音合成失败：" + (e && e.message ? e.message : e));
        return null;
      }
    },

    _currentAudio: null,
    /**
     * 播放音频 Blob。返回控制器 { stop }。
     */
    playBlob: function (blob) {
      if (ttsSystem._currentAudio) {
        try { ttsSystem._currentAudio.pause(); } catch (e) {}
        ttsSystem._currentAudio = null;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsSystem._currentAudio = audio;
      audio.onended = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (ttsSystem._currentAudio === audio) ttsSystem._currentAudio = null;
      };
      audio.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (ttsSystem._currentAudio === audio) ttsSystem._currentAudio = null;
      };
      audio.play().catch(function (err) {
        showToast("播放被浏览器拦截：" + (err && err.message ? err.message : err));
      });
      return {
        stop: function () {
          try { audio.pause(); URL.revokeObjectURL(url); } catch (e) {}
          if (ttsSystem._currentAudio === audio) ttsSystem._currentAudio = null;
        }
      };
    },

    /**
     * 停止当前播放。
     */
    stop: function () {
      if (ttsSystem._currentAudio) {
        try { ttsSystem._currentAudio.pause(); } catch (e) {}
        ttsSystem._currentAudio = null;
      }
    },

    /**
     * 清理超过 3 天的过期缓存语音。被收藏的语音不受此清理影响，可反复收听，
     * 只有在收藏室手动移除收藏后才会重新纳入清理范围。在应用启动与每次合成后调用。
     */
    cleanupExpiredCache: async function () {
      const cacheDb = getTtsDb();
      if (!cacheDb) return;
      try {
        const threshold = Date.now() - CACHE_TTL;
        const expired = await cacheDb.tts_cache.where("createdAt").below(threshold).toArray();
        if (expired.length === 0) return;

        // 收集所有被收藏的语音消息文本，这些语音不受3天清理影响，可反复收听
        const favTexts = new Set();
        if (typeof db !== "undefined" && db) {
          try {
            // 线上对话中的收藏语音
            const onlineFavVoices = await db.messages
              .filter(m => m.isFavorite === 1 && m.contentType === 'voice')
              .toArray();
            onlineFavVoices.forEach(m => {
              try {
                const d = JSON.parse(m.content);
                if (d && d.text) favTexts.add(d.text);
              } catch (e) {}
            });
            // 线下小剧场中的收藏语音
            const offlineFavVoices = await db.offline_messages
              .filter(m => m.isFavorite === 1 && m.contentType === 'voice')
              .toArray();
            offlineFavVoices.forEach(m => {
              try {
                const d = JSON.parse(m.content);
                if (d && d.text) favTexts.add(d.text);
              } catch (e) {}
            });
          } catch (e) {
            console.warn("[TTS] 读取收藏语音列表失败，本次将清理全部过期缓存", e);
          }
        }

        // 仅删除非收藏的过期语音缓存，收藏的语音保留以供反复收听
        const keysToDelete = expired
          .filter(r => !favTexts.has(r.text))
          .map(r => r.key);

        if (keysToDelete.length > 0) {
          await cacheDb.tts_cache.bulkDelete(keysToDelete);
          console.log("[TTS] 已清理过期语音缓存", keysToDelete.length, "条，保留收藏语音", expired.length - keysToDelete.length, "条");
        }
      } catch (e) {
        console.warn("[TTS] 清理缓存失败", e);
      }
    },

    /**
     * 应用启动时初始化：清理过期缓存。
     */
    init: function () {
      ttsSystem.cleanupExpiredCache();
    }
  };

  window.ttsSystem = ttsSystem;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { ttsSystem.init(); });
  } else {
    ttsSystem.init();
  }
})();
