/**
 * app_image_gen.js - 生图功能模块
 * 包含：API预设管理、画师串管理（含内置写实韩系清爽风）、会话级生图配置（锁脸/画师串/正负提示词）
 * 以及上下文感知生图触发、图片全屏查看与收藏室集成。
 */
(function() {
  'use strict';

  // 注入生图加载动画样式
  if (!document.getElementById('imagegen-spin-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'imagegen-spin-style';
    styleEl.textContent = `
      @keyframes imagegen-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // ============================================================
  //  0. 内置写实韩系清爽画师串
  //  特点：写实风+韩系风+清爽感，避免油腻与过度滤镜
  // ============================================================
  const BUILTIN_ARTIST_PROMPT = `realistic photo, korean style, clean and fresh aesthetic,
soft natural lighting, gentle warm sunlight, morning glow,
flawless dewy skin, natural makeup, subtle glow, healthy complexion,
delicate facial features, soft jawline, bright clear eyes, natural eyebrows,
minimalist composition, soft bokeh background, muted pastel tones,
shot on Sony A7R IV, 85mm f/1.4 lens, shallow depth of field,
high detail, ultra realistic, photorealistic, 8k uhd,
professional portrait photography, editorial quality,
natural color grading, no over-processing, no heavy filters,
clean composition, negative space, airy atmosphere,
skin pores visible, realistic texture, no airbrushing,
true to life colors, soft shadows, gentle highlights`;

  // 内置画师串记录（首次初始化时写入 db.imagegen_artists）
  const BUILTIN_ARTIST = {
    name: '写实韩系清爽风（内置）',
    prompt: BUILTIN_ARTIST_PROMPT,
    isBuiltin: 1
  };

  // 通用负面提示词（用户未填时使用）
  const DEFAULT_NEGATIVE_PROMPT = `nsfw, nude, lowres, bad anatomy, bad hands, text, error, missing fingers,
extra digit, fewer digits, cropped, worst quality, low quality, normal quality,
jpeg artifacts, signature, watermark, username, blurry, deformed, disfigured,
poorly drawn face, mutation, malformed, missing arms, missing legs,
extra arms, extra legs, fused fingers, too many fingers, long neck,
cartoon, anime, 3d render, painting, illustration, drawing, sketch,
oversaturated, overexposed, overprocessed, heavy filter, airbrushed, plastic skin`;

  // ============================================================
  //  1. 工具函数：图片在轨压缩
  // ============================================================
  // 将上传的图片压缩为 JPEG dataURL（最长边不超过 maxSize，质量 0.82）
  // 用于锁脸照片与生图触发后的图像存储
  function compressImage(file, maxSize = 768) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('非图片文件'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxSize) {
            height = Math.round(height * maxSize / width);
            width = maxSize;
          } else if (height > maxSize) {
            width = Math.round(width * maxSize / height);
            height = maxSize;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          try {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            resolve(dataUrl);
          } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 将已生成的 dataURL/远程图片压缩为更小的 JPEG dataURL（默认最长边 640，质量 0.78）
  // 用于生图结果落库前压缩，避免大图导致内存爆炸卡顿
  function compressDataUrl(dataUrl, maxSize = 640, quality = 0.78) {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(null); return; }
      // 非 data: 协议（远程 URL）无法直接压缩，回传原值
      if (!dataUrl.startsWith('data:image/')) { resolve(dataUrl); return; }
      try {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxSize) {
            height = Math.round(height * maxSize / width);
            width = maxSize;
          } else if (height > maxSize) {
            width = Math.round(width * maxSize / height);
            height = maxSize;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          try {
            const out = canvas.toDataURL('image/jpeg', quality);
            resolve(out);
          } catch (e) {
            resolve(dataUrl); // 压缩失败回传原值
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch (e) {
        resolve(dataUrl);
      }
    });
  }

  // 调用 vision 模型分析正脸照片，生成详细外貌描述（用于锁脸）
  // 优先使用对话主 API（与聊天同源），失败时尝试生图 API
  async function describeFaceByVision(lockfaceImages) {
    if (!lockfaceImages || !lockfaceImages.length) return null;
    try {
      // 取第一张正脸做分析
      const faceImg = lockfaceImages[0];
      let apiUrl = '', apiKey = '', model = '';
      // 优先：主聊天 API
      try {
        const presetId = localStorage.getItem('global_api_preset_id');
        if (presetId) {
          const api = await db.api_presets.get(Number(presetId));
          if (api && api.url && api.key) {
            apiUrl = api.url.replace(/\/$/, '');
            apiKey = api.key;
            model = api.model;
          }
        }
      } catch (e) {}
      // 兜底：生图 API
      if (!apiUrl) {
        const preset = await getGlobalPreset();
        if (preset && preset.url && preset.key) {
          apiUrl = preset.url.replace(/\/$/, '');
          apiKey = preset.key;
          model = preset.model;
        }
      }
      if (!apiUrl) return null;

      const body = {
        model: model || 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请详细客观描述这张人脸的外貌特征，用于AI生图锁脸参考。必须包含：性别、年龄、脸型、发型发色、眼睛形状颜色、眉毛、鼻型、嘴唇、肤色、有无眼镜/痣/酒窝等标志性特征。只输出外貌描述，不要分析情绪、不要给建议，200字以内。如果照片不是清晰人脸，输出"无法识别".' },
            { type: 'image_url', image_url: { url: faceImg } }
          ]
        }],
        max_tokens: 400,
        temperature: 0.3
      };
      const resp = await fetch(apiUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(body)
      });
      if (!resp.ok) { console.warn('[生图锁脸] vision识别失败 HTTP', resp.status); return null; }
      const data = await resp.json();
      const desc = data.choices?.[0]?.message?.content?.trim();
      if (desc && !desc.includes('无法识别')) {
        console.log('[生图锁脸] 识别到外貌:', desc.slice(0, 80));
        return desc;
      }
      return null;
    } catch (e) {
      console.warn('[生图锁脸] vision识别异常:', e);
      return null;
    }
  }

  // ============================================================
  //  2. 初始化：内置画师串注入
  // ============================================================
  async function ensureBuiltinArtist() {
    try {
      const builtin = await db.imagegen_artists.where('isBuiltin').equals(1).first();
      if (!builtin) {
        await db.imagegen_artists.add({
          ...BUILTIN_ARTIST,
          createdAt: Date.now()
        });
      }
    } catch (e) {
      console.warn('内置画师串初始化失败:', e);
    }
  }

  // ============================================================
  //  3. 设置面板：API预设 + 画师串管理
  // ============================================================
  async function initSettingsPanel() {
    await ensureBuiltinArtist();
    await loadPresetsList();
    await loadArtistsList();
    bindSettingsEvents();

    // 自动选中上次的预设：优先全局预设，其次最近使用的预设
    const presetSelect = document.getElementById('settings-imagegen-presets-select');
    if (presetSelect) {
      let targetId = null;
      // 1. 优先选全局预设
      try {
        const globalPreset = await db.imagegen_presets.where('isGlobal').equals(1).first();
        if (globalPreset) targetId = globalPreset.id;
      } catch(e) {}
      // 2. 其次选最近使用的预设（localStorage 记录）
      if (!targetId) {
        const lastId = localStorage.getItem('imagegen_last_preset_id');
        if (lastId) {
          const exist = await db.imagegen_presets.get(Number(lastId));
          if (exist) targetId = exist.id;
        }
      }
      // 3. 其次选最近创建的预设
      if (!targetId) {
        const latest = await db.imagegen_presets.orderBy('createdAt').last();
        if (latest) targetId = latest.id;
      }
      if (targetId) {
        presetSelect.value = String(targetId);
        // 触发 onchange 回填到表单
        if (typeof presetSelect.onchange === 'function') presetSelect.onchange();
      } else {
        // 无预设：清空表单
        document.getElementById('settings-imagegen-preset-name').value = '';
        document.getElementById('settings-imagegen-preset-url').value = '';
        document.getElementById('settings-imagegen-preset-key').value = '';
        document.getElementById('settings-imagegen-preset-model').innerHTML = '<option value="">-- 先填URL/Key后拉取 --</option>';
      }
    }

    // 自动选中上次的画师串：优先内置，其次最近使用
    const artistSelect = document.getElementById('settings-imagegen-artists-select');
    if (artistSelect) {
      let targetArtistId = null;
      const lastArtistId = localStorage.getItem('imagegen_last_artist_id');
      if (lastArtistId) {
        const exist = await db.imagegen_artists.get(Number(lastArtistId));
        if (exist) targetArtistId = exist.id;
      }
      if (!targetArtistId) {
        const builtin = await db.imagegen_artists.where('isBuiltin').equals(1).first();
        if (builtin) targetArtistId = builtin.id;
      }
      if (targetArtistId) {
        artistSelect.value = String(targetArtistId);
        if (typeof artistSelect.onchange === 'function') artistSelect.onchange();
      } else {
        document.getElementById('settings-imagegen-artist-name').value = '';
        document.getElementById('settings-imagegen-artist-prompt').value = '';
      }
    }
  }

  async function loadPresetsList() {
    const select = document.getElementById('settings-imagegen-presets-select');
    if (!select) return;
    const presets = await db.imagegen_presets.toArray();
    select.innerHTML = '<option value="">-- 新建预设 --</option>';
    presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.isGlobal ? '（全局）' : '');
      select.appendChild(opt);
    });
  }

  async function loadArtistsList() {
    const select = document.getElementById('settings-imagegen-artists-select');
    if (!select) return;
    const artists = await db.imagegen_artists.toArray();
    select.innerHTML = '<option value="">-- 新建画师串 --</option>';
    artists.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + (a.isBuiltin ? '（内置）' : '');
      select.appendChild(opt);
    });
  }

  function bindSettingsEvents() {
    // 切换预设：加载到表单
    const presetSelect = document.getElementById('settings-imagegen-presets-select');
    if (presetSelect) presetSelect.onchange = async () => {
      const id = Number(presetSelect.value);
      if (!id) {
        document.getElementById('settings-imagegen-preset-name').value = '';
        document.getElementById('settings-imagegen-preset-url').value = '';
        document.getElementById('settings-imagegen-preset-key').value = '';
        document.getElementById('settings-imagegen-preset-model').innerHTML = '<option value="">-- 先填URL/Key后拉取 --</option>';
        return;
      }
      const p = await db.imagegen_presets.get(id);
      if (p) {
        document.getElementById('settings-imagegen-preset-name').value = p.name || '';
        document.getElementById('settings-imagegen-preset-url').value = p.url || '';
        document.getElementById('settings-imagegen-preset-key').value = p.key || '';
        const modelSel = document.getElementById('settings-imagegen-preset-model');
        modelSel.innerHTML = '<option value="' + escapeHtml(p.model || '') + '">' + escapeHtml(p.model || '未设置') + '</option>';
      }
    };

    // 拉取模型列表
    const fetchBtn = document.getElementById('btn-fetch-imagegen-models');
    if (fetchBtn) fetchBtn.onclick = () => fetchModels();

    // 测试连接
    const testBtn = document.getElementById('btn-test-imagegen-connection');
    if (testBtn) testBtn.onclick = () => testConnection();

    // 保存/更新预设
    const saveBtn = document.getElementById('btn-save-imagegen-preset');
    if (saveBtn) saveBtn.onclick = () => savePreset();

    // 删除预设
    const delBtn = document.getElementById('btn-delete-imagegen-preset');
    if (delBtn) delBtn.onclick = () => deletePreset();

    // 全局应用
    const applyBtn = document.getElementById('btn-apply-imagegen-global');
    if (applyBtn) applyBtn.onclick = () => applyPresetGlobal();

    // 画师串切换
    const artistSelect = document.getElementById('settings-imagegen-artists-select');
    if (artistSelect) artistSelect.onchange = async () => {
      const id = Number(artistSelect.value);
      const delArtistBtn = document.getElementById('btn-delete-imagegen-artist');
      if (!id) {
        document.getElementById('settings-imagegen-artist-name').value = '';
        document.getElementById('settings-imagegen-artist-prompt').value = '';
        if (delArtistBtn) delArtistBtn.disabled = true;
        return;
      }
      const a = await db.imagegen_artists.get(id);
      if (a) {
        document.getElementById('settings-imagegen-artist-name').value = a.name || '';
        document.getElementById('settings-imagegen-artist-prompt').value = a.prompt || '';
        if (delArtistBtn) delArtistBtn.disabled = !!a.isBuiltin; // 内置不可删
      }
    };

    // 保存画师串
    const saveArtistBtn = document.getElementById('btn-save-imagegen-artist');
    if (saveArtistBtn) saveArtistBtn.onclick = () => saveArtist();

    // 删除画师串
    const delArtistBtn = document.getElementById('btn-delete-imagegen-artist');
    if (delArtistBtn) delArtistBtn.onclick = () => deleteArtist();
  }

  // 从表单读取 URL/Key
  function readApiForm() {
    const url = document.getElementById('settings-imagegen-preset-url').value.trim();
    const key = document.getElementById('settings-imagegen-preset-key').value.trim();
    const model = document.getElementById('settings-imagegen-preset-model').value.trim();
    return { url, key, model };
  }

  // 拉取模型列表（兼容 OpenAI /v1/models 与部分生图服务的 /v1/models）
  async function fetchModels() {
    const { url, key } = readApiForm();
    const modelSel = document.getElementById('settings-imagegen-preset-model');
    const resultEl = document.getElementById('imagegen-test-result');
    if (!url) { if (resultEl) resultEl.textContent = '请先填写 API URL'; return; }
    if (resultEl) { resultEl.textContent = '正在拉取模型...'; resultEl.style.color = '#3b82f6'; }
    try {
      const resp = await fetch(url.replace(/\/$/, '') + '/models', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + key }
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
      modelSel.innerHTML = '';
      if (!list.length) {
        modelSel.innerHTML = '<option value="">-- 无可用模型，请手填 --</option>';
        // 允许手填
        const custom = document.createElement('input');
        custom.type = 'text';
        custom.placeholder = '手填模型名';
        custom.id = 'settings-imagegen-preset-model-input';
        custom.style.cssText = 'flex:1;padding:6px;font-size:12px;border:1.5px solid var(--border);border-radius:8px;display:none;';
      } else {
        list.forEach(m => {
          const id = m.id || m.name || m;
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = id;
          modelSel.appendChild(opt);
        });
      }
      if (resultEl) { resultEl.textContent = '✓ 拉取到 ' + list.length + ' 个模型'; resultEl.style.color = '#10b981'; }
    } catch (e) {
      if (resultEl) { resultEl.textContent = '✗ 拉取失败：' + e.message + '（可手填模型名后保存）'; resultEl.style.color = '#ef4444'; }
      // 拉取失败时允许手填
      modelSel.innerHTML = '<option value="">-- 拉取失败，请手填 --</option>';
    }
  }

  // 测试连接：发一个最简单的生图请求
  async function testConnection() {
    const { url, key, model } = readApiForm();
    const resultEl = document.getElementById('imagegen-test-result');
    if (!url || !key) { if (resultEl) resultEl.textContent = '请填写 URL 与 Key'; return; }
    if (resultEl) { resultEl.textContent = '正在测试连接...'; resultEl.style.color = '#3b82f6'; }
    try {
      const testModel = (model || 'dall-e-3').toLowerCase();
      const isOpenAIModel = testModel.includes('gpt-image') || testModel.includes('dall-e-3');
      const body = {
        model: model || 'dall-e-3',
        prompt: 'a red apple, test',
        n: 1,
        size: isOpenAIModel ? '1024x1024' : '512x512'
      };
      if (isOpenAIModel) body.response_format = 'b64_json';
      const resp = await fetch(url.replace(/\/$/, '') + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (data.data && data.data.length) {
        if (resultEl) { resultEl.textContent = '✓ 连接成功，可正常生图'; resultEl.style.color = '#10b981'; }
      } else {
        throw new Error('响应无图像数据');
      }
    } catch (e) {
      if (resultEl) { resultEl.textContent = '✗ 测试失败：' + e.message; resultEl.style.color = '#ef4444'; }
    }
  }

  // 保存/更新预设
  async function savePreset() {
    const select = document.getElementById('settings-imagegen-presets-select');
    const id = Number(select.value);
    const name = document.getElementById('settings-imagegen-preset-name').value.trim();
    const { url, key, model } = readApiForm();
    if (!name || !url || !key) { showToast('请完整填写名称、URL、Key'); return; }
    let newId;
    if (id) {
      await db.imagegen_presets.update(id, { name, url, key, model });
      newId = id;
      showToast('预设已更新');
    } else {
      newId = await db.imagegen_presets.add({ name, url, key, model, isGlobal: 0, createdAt: Date.now() });
      showToast('预设已保存');
    }
    // 记录最近使用的预设，下次打开自动选中
    localStorage.setItem('imagegen_last_preset_id', String(newId));
    await loadPresetsList();
    select.value = String(newId);
  }

  async function deletePreset() {
    const select = document.getElementById('settings-imagegen-presets-select');
    const id = Number(select.value);
    if (!id) { showToast('请选择要删除的预设'); return; }
    if (!confirm('确认删除该预设？')) return;
    await db.imagegen_presets.delete(id);
    await loadPresetsList();
    document.getElementById('settings-imagegen-preset-name').value = '';
    document.getElementById('settings-imagegen-preset-url').value = '';
    document.getElementById('settings-imagegen-preset-key').value = '';
    document.getElementById('settings-imagegen-preset-model').innerHTML = '<option value="">-- 先填URL/Key后拉取 --</option>';
    showToast('预设已删除');
  }

  // 全局应用预设：标记 isGlobal=1，其余预设 isGlobal=0
  async function applyPresetGlobal() {
    const select = document.getElementById('settings-imagegen-presets-select');
    const id = Number(select.value);
    if (!id) { showToast('请先选择一个预设'); return; }
    const all = await db.imagegen_presets.toArray();
    for (const p of all) {
      await db.imagegen_presets.update(p.id, { isGlobal: p.id === id ? 1 : 0 });
    }
    localStorage.setItem('global_imagegen_preset_id', String(id));
    showToast('已全局应用该预设');
    await loadPresetsList();
    select.value = String(id);
  }

  // 获取全局预设（供生图触发使用）
  async function getGlobalPreset() {
    const id = Number(localStorage.getItem('global_imagegen_preset_id') || 0);
    if (id) {
      const p = await db.imagegen_presets.get(id);
      if (p) return p;
    }
    // 兜底：取 isGlobal=1 的
    return await db.imagegen_presets.where('isGlobal').equals(1).first();
  }

  // 保存画师串
  async function saveArtist() {
    const select = document.getElementById('settings-imagegen-artists-select');
    const id = Number(select.value);
    const name = document.getElementById('settings-imagegen-artist-name').value.trim();
    const prompt = document.getElementById('settings-imagegen-artist-prompt').value.trim();
    if (!name || !prompt) { showToast('请完整填写名称与画师串'); return; }
    let newId;
    if (id) {
      const exist = await db.imagegen_artists.get(id);
      if (exist && exist.isBuiltin) { showToast('内置画师串不可修改'); return; }
      await db.imagegen_artists.update(id, { name, prompt });
      newId = id;
      showToast('画师串已更新');
    } else {
      newId = await db.imagegen_artists.add({ name, prompt, isBuiltin: 0, createdAt: Date.now() });
      showToast('画师串已保存');
    }
    localStorage.setItem('imagegen_last_artist_id', String(newId));
    await loadArtistsList();
    select.value = String(newId);
  }

  async function deleteArtist() {
    const select = document.getElementById('settings-imagegen-artists-select');
    const id = Number(select.value);
    if (!id) { showToast('请选择要删除的画师串'); return; }
    const a = await db.imagegen_artists.get(id);
    if (a && a.isBuiltin) { showToast('内置画师串不可删除'); return; }
    if (!confirm('确认删除该画师串？')) return;
    await db.imagegen_artists.delete(id);
    await loadArtistsList();
    document.getElementById('settings-imagegen-artist-name').value = '';
    document.getElementById('settings-imagegen-artist-prompt').value = '';
    showToast('画师串已删除');
  }

  // ============================================================
  //  4. 会话级生图设置面板
  // ============================================================
  let pendingLockfaceImages = []; // 待保存的锁脸 dataURL 数组

  async function openSessionPanel() {
    if (typeof activeSessionId === 'undefined' || !activeSessionId) {
      showToast('请先选择一个对话');
      return;
    }
    const panel = document.getElementById('imagegen-session-panel');
    if (!panel) return;
    panel.classList.add('active');
    await loadSessionSettings();
    bindSessionEvents();
  }

  async function loadSessionSettings() {
    await ensureBuiltinArtist();
    // 加载画师串下拉
    const artistSel = document.getElementById('imagegen-session-artist-select');
    const artists = await db.imagegen_artists.toArray();
    artistSel.innerHTML = '<option value="">-- 不使用画师串 --</option>';
    artists.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + (a.isBuiltin ? '（内置）' : '');
      artistSel.appendChild(opt);
    });

    // 加载已有设置
    const s = await db.imagegen_session_settings.where('sessionId').equals(Number(activeSessionId)).first();
    pendingLockfaceImages = (s && s.lockfaceImages) ? s.lockfaceImages.slice() : [];
    document.getElementById('imagegen-session-chat-toggle').checked = !!(s && s.chatEnabled);
    document.getElementById('imagegen-session-moments-toggle').checked = !!(s && s.momentsEnabled);
    artistSel.value = (s && s.artistId) ? String(s.artistId) : '';
    document.getElementById('imagegen-session-positive-prompt').value = (s && s.positivePrompt) || '';
    document.getElementById('imagegen-session-negative-prompt').value = (s && s.negativePrompt) || '';
    renderLockfacePreview();
  }

  function renderLockfacePreview() {
    const c = document.getElementById('imagegen-lockface-preview');
    if (!c) return;
    c.innerHTML = '';
    pendingLockfaceImages.forEach((dataUrl, idx) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;border:1.5px solid var(--border);';
      wrap.innerHTML =
        '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;">' +
        '<button data-idx="' + idx + '" style="position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;font-size:10px;cursor:pointer;line-height:14px;">×</button>';
      c.appendChild(wrap);
    });
    // 绑定删除
    c.querySelectorAll('button[data-idx]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-idx'));
        pendingLockfaceImages.splice(idx, 1);
        renderLockfacePreview();
      };
    });
  }

  function bindSessionEvents() {
    const uploadBtn = document.getElementById('btn-imagegen-upload-lockface');
    const fileInput = document.getElementById('file-imagegen-lockface');
    const clearBtn = document.getElementById('btn-imagegen-clear-lockface');
    const saveBtn = document.getElementById('btn-save-imagegen-session');

    if (uploadBtn) uploadBtn.onclick = () => fileInput.click();
    if (clearBtn) clearBtn.onclick = () => {
      pendingLockfaceImages = [];
      renderLockfacePreview();
    };
    if (fileInput) fileInput.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      // 限制最多3张
      const remain = 3 - pendingLockfaceImages.length;
      if (remain <= 0) { showToast('最多上传3张正脸照片'); e.target.value = ''; return; }
      const toProcess = files.slice(0, remain);
      if (files.length > remain) showToast('仅取前 ' + remain + ' 张，最多3张');
      for (const f of toProcess) {
        try {
          // 在轨压缩
          const dataUrl = await compressImage(f, 768);
          pendingLockfaceImages.push(dataUrl);
        } catch (err) {
          console.warn('锁脸图片压缩失败:', err);
        }
      }
      renderLockfacePreview();
      e.target.value = '';
    };
    if (saveBtn) saveBtn.onclick = () => saveSessionSettings();
  }

  async function saveSessionSettings() {
    if (typeof activeSessionId === 'undefined' || !activeSessionId) {
      showToast('当前无活跃对话');
      return;
    }
    const chatEnabled = document.getElementById('imagegen-session-chat-toggle').checked ? 1 : 0;
    const momentsEnabled = document.getElementById('imagegen-session-moments-toggle').checked ? 1 : 0;
    const artistId = Number(document.getElementById('imagegen-session-artist-select').value) || null;
    const positivePrompt = document.getElementById('imagegen-session-positive-prompt').value.trim();
    const negativePrompt = document.getElementById('imagegen-session-negative-prompt').value.trim();
    const now = Date.now();

    const exist = await db.imagegen_session_settings.where('sessionId').equals(Number(activeSessionId)).first();
    if (exist) {
      await db.imagegen_session_settings.update(exist.id, {
        chatEnabled, momentsEnabled, artistId, positivePrompt, negativePrompt,
        lockfaceImages: pendingLockfaceImages, updatedAt: now
      });
    } else {
      await db.imagegen_session_settings.add({
        sessionId: Number(activeSessionId),
        chatEnabled, momentsEnabled, artistId, positivePrompt, negativePrompt,
        lockfaceImages: pendingLockfaceImages, createdAt: now, updatedAt: now
      });
    }
    showToast('生图设置已保存');
    document.getElementById('imagegen-session-panel').classList.remove('active');
  }

  // 获取会话生图配置
  async function getSessionSettings(sessionId) {
    if (!sessionId) return null;
    return await db.imagegen_session_settings.where('sessionId').equals(Number(sessionId)).first();
  }

  // ============================================================
  //  5. 上下文感知生图触发
  // ============================================================
  // 根据 AI 文本消息内容推断生图主题（不能 OOC）
  // 策略：AI 的图片描述本身就是最好的场景描述，直接作为 prompt 开头
  // gpt-image-2 对 prompt 开头最敏感，开头是场景描述就能确保场景生效
  // 只对纯静物（无人物迹象）用模板
  function inferImageSubject(text) {
    if (!text) return 'a photo of a person';
    const t = text.toLowerCase();

    // 人物迹象检测（宽口径：人物名词 + 人物动作 + 人称代词）
    const personSigns = /男生|女生|男人|女人|男孩|女孩|年轻人|小伙|姑娘|家伙|一个男|一个女|小哥哥|小姐姐|自拍|selfie|拍张照|看看我|我的样子|照片发你|发张照片|拍自己|今天的我|全身|穿搭|今天穿|我的衣服|ootd|portrait|boy|girl|man|woman|person|\bhe\b|\bshe\b|handsome|beautiful|standing|sitting|lying|对着镜头|微笑|勾起嘴角|神情|表情|脸|撑着|端着|盯着|看着|拿着|举着|靠着|坐着|站着|弯腰|抬头|低头|转头|侧身|回头|挥手|比耶|剪刀手|托腮|托着|托腮|皱眉|眨眼|嘟嘴|舔唇|咬唇|叉腰|插兜|双手|右手|左手|肩膀|脖子|锁骨|胸口|腰|腿|脚|手臂|手指/;
    const hasPerson = personSigns.test(t);

    // 1. 含人物迹象：直接用 AI 原文作为 prompt 开头（保留全部场景细节）
    //    不加 "portrait photo of a person" 前缀，避免模型优先生成纯人像忽略场景
    if (hasPerson) {
      // 直接返回原文，gpt-image-2 支持中文理解
      // 截取前 800 字符避免过长
      return text.slice(0, 800);
    }

    // 2. 纯食物场景（无人物）
    if (/吃什么|吃的|美食|早餐|午餐|晚餐|夜宵|喝的|奶茶|看看我.*吃|我在吃|品尝|这顿|菜品|餐厅|咖啡/.test(t)) {
      return 'food photography, appetizing meal on table, top-down view, warm lighting';
    }
    // 3. 纯风景场景（无人）
    if (/风景|户外|散步|路上|街景|海边|山顶|公园|天气|日落|日出/.test(t)) {
      return 'landscape scenery, outdoor view, natural lighting';
    }
    // 4. 宠物场景（无人）
    if (/猫|狗|宠物|喵|汪/.test(t)) {
      return 'cute pet photo, adorable animal, soft fur, natural pose';
    }
    // 5. 室内场景（无人）
    if (/房间|居家|家里|卧室|客厅|沙发/.test(t)) {
      return 'cozy home interior, warm room, soft natural light';
    }

    // 6. 默认：直接用原文
    return text.slice(0, 800);
  }

  // 清理 prompt 中的 Midjourney 语法参数（--ar --n --style 等），返回纯文本
  // 同时提取 --ar 宽高比信息，供 size 适配使用
  function cleanPromptParams(text) {
    if (!text) return { clean: '', aspect: null };
    let aspect = null;
    // 提取 --ar W:H 或 --ratio W:H
    const arMatch = text.match(/--ar\s+(\d+):(\d+)/i) || text.match(/--ratio\s+(\d+):(\d+)/i);
    if (arMatch) {
      const w = Number(arMatch[1]), h = Number(arMatch[2]);
      if (w > 0 && h > 0) {
        if (w > h) aspect = 'landscape';       // 横图
        else if (h > w) aspect = 'portrait';   // 竖图
        else aspect = 'square';
      }
    }
    // 移除所有 --xxx 参数（Midjourney/Stable Diffusion 语法）
    const clean = text.replace(/--\w+\s+\S+/g, '').replace(/\s+/g, ' ').trim();
    return { clean, aspect };
  }

  // 组装完整正向提示词
  // 结构优先级（gpt-image-2 对开头最敏感，场景在最前确保不OOC）：
  // 1. 上下文主题（场景，最前，确保生成内容符合对话）
  // 2. 外貌描写（档案馆 appearance，身份约束）
  // 3. vision 锁脸描述（面部特征约束）
  // 4. 画师串（风格，简短）
  // 5. 用户追加
  // extraFaceDesc: 由 vision 识别正脸照片生成的外貌描述（强约束），可选
  async function buildPositivePrompt(sessionSettings, subjectText, extraFaceDesc) {
    let parts = [];

    // 1. 上下文主题（场景）—— 放最前面，确保场景不被忽略
    parts.push(subjectText);

    // 2. 外貌描写（来自档案馆 appearance 字段，身份约束）
    // 清理 Midjourney 参数语法（--ar 等），避免污染 prompt
    if (sessionSettings && sessionSettings.appearance) {
      const { clean } = cleanPromptParams(sessionSettings.appearance);
      if (clean) parts.push(clean);
    }

    // 3. vision 锁脸描述（面部特征约束）
    if (extraFaceDesc) {
      parts.push('face features: ' + extraFaceDesc);
    }

    // 4. 画师串（风格，放后面）
    if (sessionSettings && sessionSettings.artistId) {
      const artist = await db.imagegen_artists.get(sessionSettings.artistId);
      if (artist && artist.prompt) {
        const { clean } = cleanPromptParams(artist.prompt);
        parts.push(clean.slice(0, 400));
      }
    } else {
      const builtin = await db.imagegen_artists.where('isBuiltin').equals(1).first();
      if (builtin && builtin.prompt) {
        const { clean } = cleanPromptParams(builtin.prompt);
        parts.push(clean.slice(0, 400));
      }
    }

    // 5. 用户追加正向提示词
    if (sessionSettings && sessionSettings.positivePrompt) {
      const { clean } = cleanPromptParams(sessionSettings.positivePrompt);
      if (clean) parts.push(clean);
    }

    let prompt = parts.filter(Boolean).join(',\n');
    if (prompt.length > 3500) {
      prompt = prompt.slice(0, 3500);
      console.warn('[生图] prompt超过3500字符，已截断');
    }
    return prompt;
  }

  // 从外貌描写/画师串中提取宽高比偏好，转换为 OpenAI/SDXL 的 size 参数
  function inferSizeFromSettings(sessSettings, isOpenAIModel) {
    let aspect = null;
    if (sessSettings && sessSettings.appearance) {
      const { aspect: a } = cleanPromptParams(sessSettings.appearance);
      if (a) aspect = a;
    }
    if (!aspect && sessSettings && sessSettings.positivePrompt) {
      const { aspect: a } = cleanPromptParams(sessSettings.positivePrompt);
      if (a) aspect = a;
    }
    if (isOpenAIModel) {
      if (aspect === 'portrait') return '1024x1536';
      if (aspect === 'landscape') return '1536x1024';
      return '1024x1024';
    } else {
      if (aspect === 'portrait') return '768x1152';
      if (aspect === 'landscape') return '1152x768';
      return '768x768';
    }
  }

  // 组装负面提示词
  function buildNegativePrompt(sessionSettings) {
    if (sessionSettings && sessionSettings.negativePrompt) {
      return DEFAULT_NEGATIVE_PROMPT + ',\n' + sessionSettings.negativePrompt;
    }
    return DEFAULT_NEGATIVE_PROMPT;
  }

  /**
   * 生图触发入口：
   * @param {Object} opts - { sessionId, scene: 'chat'|'moments', aiText, onComplete }
   * scene='chat' 时表示对话中角色发送图片，scene='moments' 表示朋友圈生图
   * aiText 为角色的文本消息（用于上下文感知推断主题）
   * onComplete(dataUrl) 回调返回生成的图片 dataURL（失败时回传 null）
   */
  async function triggerImageGeneration(opts) {
    const { sessionId, scene, aiText, onComplete } = opts;
    try {
      console.log('[生图] 触发开始', { scene, sessionId, aiText: (aiText||'').slice(0,60) });
      const sessSettings = await getSessionSettings(sessionId);
      if (!sessSettings) {
        console.warn('[生图] 跳过：该会话未配置生图设置（请在对话详情-生图设置中开启）');
        if (onComplete) onComplete(null); return;
      }
      // 检查开关
      if (scene === 'chat' && !sessSettings.chatEnabled) {
        console.warn('[生图] 跳过：聊天生图开关未开启');
        if (onComplete) onComplete(null); return;
      }
      if (scene === 'moments' && !sessSettings.momentsEnabled) {
        console.warn('[生图] 跳过：朋友圈生图开关未开启');
        if (onComplete) onComplete(null); return;
      }

      // 获取全局 API 预设
      const preset = await getGlobalPreset();
      if (!preset || !preset.url || !preset.key) {
        console.warn('[生图] 跳过：未配置全局生图 API 预设（请到设置-生图设置中配置并点"全局应用"）');
        if (onComplete) onComplete(null);
        return;
      }

      // 注入档案馆 appearance 外貌字段（来自 char/user/npc 档案）
      // 优先级：char > npc > user（生图通常生成角色，故以 char 为准）
      let appearanceDesc = '';
      let archiveLockface = null; // 档案馆锁脸正脸照片（优先于会话级配置）
      try {
        const sess = await db.sessions.get(Number(sessionId));
        if (sess && sess.charId) {
          const char = await db.archives.get(sess.charId);
          if (char) {
            if (char.appearance) appearanceDesc = char.appearance;
            if (char.lockfaceImages && char.lockfaceImages.length) archiveLockface = char.lockfaceImages;
          }
        }
        if (!appearanceDesc && sess && sess.userId) {
          const user = await db.archives.get(sess.userId);
          if (user) {
            if (user.appearance) appearanceDesc = user.appearance;
            if (!archiveLockface && user.lockfaceImages && user.lockfaceImages.length) archiveLockface = user.lockfaceImages;
          }
        }
      } catch(e) { console.warn('[生图] 读取外貌字段失败:', e); }
      if (appearanceDesc) sessSettings.appearance = appearanceDesc;

      // 锁脸正脸照片来源优先级：档案馆 > 会话级生图设置
      const effectiveLockface = (archiveLockface && archiveLockface.length)
        ? archiveLockface
        : ((sessSettings.lockfaceImages && sessSettings.lockfaceImages.length) ? sessSettings.lockfaceImages : null);

      // vision 识别正脸照片生成详细外貌描述（锁脸强约束）
      let faceDesc = null;
      if (effectiveLockface && effectiveLockface.length) {
        console.log('[生图] 启动vision锁脸识别... 来源:', (archiveLockface && archiveLockface.length) ? '档案馆' : '会话级');
        faceDesc = await describeFaceByVision(effectiveLockface);
        // 把锁脸照片也注入到 sessSettings.lockfaceImages 以便后续可能用到
        if (!sessSettings.lockfaceImages || !sessSettings.lockfaceImages.length) {
          sessSettings.lockfaceImages = effectiveLockface;
        }
      }

      // 推断主题
      const subject = inferImageSubject(aiText);
      console.log('[生图] 推断主题:', subject.slice(0,80));
      if (faceDesc) console.log('[生图] 锁脸外貌已注入');
      const positive = await buildPositivePrompt(sessSettings, subject, faceDesc);
      const negative = buildNegativePrompt(sessSettings);

      // 构造请求体（OpenAI 兼容格式）
      // 关键：根据模型名适配 size 和 negative_prompt
      const modelName = (preset.model || 'dall-e-3').toLowerCase();
      const isGptImage = modelName.includes('gpt-image');     // gpt-image-1 / gpt-image-2
      const isDallE3 = modelName.includes('dall-e-3');
      const isOpenAIModel = isGptImage || isDallE3;            // OpenAI 系列不认 negative_prompt 字段

      const body = {
        model: preset.model || 'dall-e-3',
        prompt: positive,
        n: 1
      };

      // size 适配：从外貌描写的 --ar 参数推断宽高比，OpenAI 系列只接受特定尺寸
      if (isOpenAIModel) {
        body.size = inferSizeFromSettings(sessSettings, true);
        body.response_format = 'b64_json';
      } else {
        body.size = inferSizeFromSettings(sessSettings, false);
      }

      // negative_prompt 仅对 SDXL/Flux 等开源模型发送，OpenAI 系列发送会被忽略或报错
      if (!isOpenAIModel) {
        body.negative_prompt = negative;
      }

      const apiUrl = preset.url.replace(/\/$/, '') + '/images/generations';
      console.log('[生图] 调用API:', apiUrl, '模型:', body.model, 'size:', body.size, 'negative:', !isOpenAIModel);
      console.log('[生图] prompt前200字:', positive.slice(0,200));
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + preset.key },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(()=>'');
        throw new Error('HTTP ' + resp.status + ' ' + errText.slice(0,300));
      }
      const data = await resp.json();
      const item = data.data && data.data[0];
      if (!item) throw new Error('响应无图像数据');

      // 优先 b64_json，其次 url
      let dataUrl = null;
      if (item.b64_json) {
        dataUrl = 'data:image/png;base64,' + item.b64_json;
      } else if (item.url) {
        // 远程 URL：尝试转 dataURL（便于本地存储与收藏）
        try {
          const imgResp = await fetch(item.url);
          const blob = await imgResp.blob();
          dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
        } catch (e) {
          // 跨域失败时直接使用 URL
          dataUrl = item.url;
        }
      }

      // 双存储策略：压缩图（小图列表用，省内存）+ 高清原图（大图视图用，无损查看）
      // 避免所有图片都存高清导致列表卡顿，同时大图视图可无损回传
      let thumbUrl = dataUrl;  // 压缩缩略图
      let hdUrl = dataUrl;     // 高清原图
      if (dataUrl) {
        // 原图作为高清图保留
        hdUrl = dataUrl;
        // 压缩为缩略图（小图列表用，最长边 512，质量 0.7）
        const before = dataUrl.length;
        thumbUrl = await compressDataUrl(dataUrl, 512, 0.7);
        const after = thumbUrl ? thumbUrl.length : 0;
        console.log('[生图] 双存储 原图', (before/1024).toFixed(1)+'KB', '+ 缩略图', (after/1024).toFixed(1)+'KB');
      }

      console.log('[生图] 成功 thumbUrl:', thumbUrl ? '有' : '无', 'hdUrl:', hdUrl ? '有' : '无');
      // 返回 { thumb, hd } 对象，供调用方分别存储
      if (onComplete) onComplete(thumbUrl ? { thumb: thumbUrl, hd: hdUrl } : null);
    } catch (e) {
      console.warn('[生图] 触发异常:', e);
      if (onComplete) onComplete(null);
    }
  }

  // 图片工具栏（双击触发）：收藏、全屏查看、保存描述等操作
  // opts: { description, hdUrl, msgId }
  function showImageToolbar(msgId, src, opts) {
    opts = opts || {};
    const description = opts.description || '';
    const hdUrl = opts.hdUrl || src;

    // 移除已有工具栏
    const existing = document.getElementById('imagegen-toolbar-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'imagegen-toolbar-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10003;display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML =
      '<div id="imagegen-toolbar-panel" style="width:100%;max-width:480px;background:var(--surface, #fff);border-radius:16px 16px 0 0;padding:16px 16px 24px;box-shadow:0 -4px 20px rgba(0,0,0,0.2);transform:translateY(100%);transition:transform 0.25s ease-out;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '<span style="font-size:14px;font-weight:700;color:var(--text-primary,#333);">图片操作</span>' +
          '<button id="imagegen-toolbar-close" style="width:28px;height:28px;border:none;background:none;color:var(--text-secondary,#999);font-size:20px;cursor:pointer;">×</button>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="imagegen-toolbar-view" style="flex:1;min-width:120px;padding:12px;border-radius:10px;background:#07c160;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">全屏查看</button>' +
          '<button id="imagegen-toolbar-fav" style="flex:1;min-width:120px;padding:12px;border-radius:10px;background:rgba(255,193,7,0.15);color:#ff9800;border:1.5px solid rgba(255,193,7,0.4);font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">收藏到收藏室</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // 动画进入
    requestAnimationFrame(() => {
      const panel = document.getElementById('imagegen-toolbar-panel');
      if (panel) panel.style.transform = 'translateY(0)';
    });

    // 关闭逻辑
    const close = () => {
      const panel = document.getElementById('imagegen-toolbar-panel');
      if (panel) panel.style.transform = 'translateY(100%)';
      setTimeout(() => overlay.remove(), 250);
    };
    document.getElementById('imagegen-toolbar-close').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // 全屏查看
    document.getElementById('imagegen-toolbar-view').onclick = () => {
      close();
      openFullScreenImage(src, { description, msgId, hdSrc: hdUrl });
    };

    // 收藏（带去重）
    const favBtn = document.getElementById('imagegen-toolbar-fav');
    if (favBtn) favBtn.onclick = async () => {
      const ok = await favoriteImage(src, { msgId, description });
      if (ok) {
        favBtn.textContent = '已收藏';
        favBtn.disabled = true;
        favBtn.style.opacity = '0.6';
      }
    };
  }

  // ============================================================
  //  6. 图片全屏查看（带返回逻辑）
  // ============================================================
  // 打开全屏大图视图
  // opts: { src, description, msgId, hdSrc }
  //   src: 压缩图 dataURL（小图同款，默认展示）
  //   hdSrc: 高清原图 dataURL（大图视图懒加载，可选；无则用 src）
  //   description: 图片描述文字（大图视图底部展示）
  //   msgId: 关联消息 ID（用于收藏去重判断）
  function openFullScreenImage(src, opts) {
    if (!src) return;
    opts = opts || {};
    const hdSrc = opts.hdSrc || src;
    const description = opts.description || '';
    const msgId = opts.msgId || null;

    // 移除已有
    const existing = document.getElementById('imagegen-fullscreen-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'imagegen-fullscreen-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:10001;display:flex;align-items:center;justify-content:center;flex-direction:column;';

    // 描述文字区块（大图视图下方保留图片描述）
    const descHtml = description
      ? '<div id="imagegen-fullscreen-desc" style="max-width:88vw;max-height:18vh;overflow-y:auto;margin-top:14px;padding:10px 14px;background:rgba(255,255,255,0.08);border-radius:10px;color:#fff;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(description) + '</div>'
      : '';

    overlay.innerHTML =
      '<button id="imagegen-fullscreen-close" style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;border:none;font-size:22px;cursor:pointer;z-index:10002;">×</button>' +
      '<img id="imagegen-fullscreen-img" src="' + src + '" style="max-width:92vw;max-height:60vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">' +
      descHtml +
      '<div style="margin-top:14px;display:flex;gap:10px;">' +
        '<button id="imagegen-fullscreen-fav" style="padding:8px 18px;border-radius:20px;background:rgba(255,255,255,0.15);color:#fff;border:1.5px solid rgba(255,255,255,0.3);font-size:12px;cursor:pointer;font-weight:700;">收藏到收藏室</button>' +
      '</div>';
    document.body.appendChild(overlay);

    // 高清图懒加载：先展示压缩图，后台加载高清图替换
    if (hdSrc && hdSrc !== src) {
      const imgEl = document.getElementById('imagegen-fullscreen-img');
      const hdImg = new Image();
      hdImg.onload = () => {
        if (imgEl) imgEl.src = hdSrc;
      };
      hdImg.src = hdSrc;
    }

    // 返回逻辑：点击关闭按钮 / 点击空白处 / 按返回键
    const close = () => overlay.remove();
    document.getElementById('imagegen-fullscreen-close').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    // 返回键（Esc）
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    // 收藏按钮（带去重判断）
    const favBtn = document.getElementById('imagegen-fullscreen-fav');
    if (favBtn) favBtn.onclick = async () => {
      const ok = await favoriteImage(src, { msgId, description });
      if (ok) {
        favBtn.textContent = '已收藏';
        favBtn.disabled = true;
        favBtn.style.opacity = '0.6';
      }
    };
  }

  // 收藏到收藏室-图片（带去重判断）
  // opts: { msgId, description }
  //   msgId: 关联消息 ID，用于去重（同一条消息只能收藏一次）
  //   description: 图片描述文字
  async function favoriteImage(dataUrl, opts) {
    opts = opts || {};
    try {
      const pid = Number(localStorage.getItem('active_me_id') || 0);
      const sid = (typeof activeSessionId !== 'undefined') ? Number(activeSessionId) : 0;

      // 去重判断：同一条消息只能收藏一次
      if (opts.msgId) {
        const existing = await db.favorites
          .where('sourceMsgId').equals(Number(opts.msgId))
          .and(r => r.msgType === 'image')
          .first();
        if (existing) {
          showToast('该图片已收藏过');
          return false;
        }
      }

      await db.favorites.add({
        userId: pid,
        sessionId: sid,
        msgType: 'image',
        sourceTable: 'imagegen',
        sourceMsgId: opts.msgId ? Number(opts.msgId) : null,
        content: dataUrl,
        description: opts.description || '',
        createdAt: Date.now()
      });
      showToast('已收藏到收藏室-图片');
      return true;
    } catch (e) {
      console.warn('收藏失败:', e);
      showToast('收藏失败');
      return false;
    }
  }

  // ============================================================
  //  7. 暴露 API
  // ============================================================
  window.imageGenSystem = {
    initSettingsPanel,
    openSessionPanel,
    triggerImageGeneration,
    openFullScreenImage,
    showImageToolbar,
    favoriteImage,
    getSessionSettings,
    getGlobalPreset,
    inferImageSubject,
    compressImage,
    compressDataUrl,
    BUILTIN_ARTIST_PROMPT
  };

  // 全局工具栏函数（供 app_chat.js 直接调用）
  window.showImageToolbar = showImageToolbar;

  // 启动时确保内置画师串存在
  if (typeof db !== 'undefined') {
    ensureBuiltinArtist();
  }
})();
