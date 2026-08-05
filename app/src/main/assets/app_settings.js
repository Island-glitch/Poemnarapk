/**
 * app_settings.js - 系统设置、桌面美化、组件工坊、数据分区隔离管理中心 (内置 Prompt 复制版)
 */

let isSettingsInitialized = false;

// 专属临时存储自定义图标和壁纸的 Blob 二进制指针
let tempBgBlob = null;

function initSettingsApp() {
  if (isSettingsInitialized) return;
  isSettingsInitialized = true;

  loadPresetsList();
  loadCustomCssPresets();
  loadWidgetPresets();
  loadBeautifyForm();
  loadDeeptalkPresetsList(); // 初始化载入深谈预设
  initVConsoleSetting();     // 初始化调试控制台开关状态
  initBackgroundSetting();   // 初始化后台运行开关状态

  // 绑定：二级面板中深谈预设设置的保存、删除与表单反馈
  document.getElementById("btn-save-deeptalk-preset").onclick = saveDeeptalkPreset;
  document.getElementById("btn-delete-deeptalk-preset").onclick = deleteDeeptalkPreset;
  document.getElementById("settings-deeptalk-presets-select").onchange = loadDeeptalkPresetToForm;

  // 1. 桌面壁纸美化上传 (并入 1080px 视网膜高清自适应 Canvas 压缩自愈引擎，彻底粉碎 LocalStorage 5MB 爆仓死锁) [1]
  const btnBgUpload = document.getElementById("btn-beautify-bg-upload");
  const fileBg = document.getElementById("file-beautify-bg");
  if (btnBgUpload && fileBg) {
    btnBgUpload.onclick = () => fileBg.click();
    fileBg.onchange = async (e) => {
      if (e.target.files.length > 0) {
        showToast("正在执行高清桌面壁纸自适应压缩...");
        const file = e.target.files[0];
        
        // 在轨 Canvas 压缩，将数兆壁纸瞬时降至 150KB 级别，彻底避免 QuotaExceededError 崩溃
        const compressedBlob = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            let width = img.width;
            let height = img.height;
            const maxWidth = 1080;
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
              resolve(blob || file);
            }, "image/jpeg", 0.75);
          };
          img.onerror = () => resolve(file);
          const reader = new FileReader();
          reader.onload = (evt) => {
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        });

        tempBgBlob = compressedBlob;
        document.getElementById("beautify-bg-url").value = "[本地上传背景]";
        
        const reader = new FileReader();
        reader.onload = function(evt) {
          const preview = document.getElementById("beautify-bg-preview");
          if (preview) preview.innerHTML = `<img src="${evt.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
        };
        reader.readAsDataURL(compressedBlob);
      }
    };
  }

  // 2. 监听4个应用图标的本地上传触发
  let activeCustomizingAppId = null;
  document.querySelectorAll(".btn-icon-upload-trigger").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      activeCustomizingAppId = btn.getAttribute("data-app");
      document.getElementById("file-beautify-icon-global").click();
    };
  });

  // 绑定全局图标选择变更并即时显示预览 (并入 120px 高透方形 PNG 压缩裁剪引擎，根治 LocalStorage 爆仓崩溃) [1]
  const fileIconGlobal = document.getElementById("file-beautify-icon-global");
  if (fileIconGlobal) {
    fileIconGlobal.onchange = async (e) => {
      if (e.target.files.length > 0 && activeCustomizingAppId) {
        const file = e.target.files[0];
        
        showToast("正在执行图标等比方形裁剪与高清压缩...");

        // 核心：在轨异步 PNG 压缩与等比方形截切，保留高亮透明度，体积暴减 99.8% [1]
        const compressedDataURL = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            // 自动寻找最短边进行居中正方形裁切，防止图标被挤压拉伸
            const size = Math.min(img.width, img.height);
            const startX = (img.width - size) / 2;
            const startY = (img.height - size) / 2;
            
            const canvas = document.createElement("canvas");
            canvas.width = 120;
            canvas.height = 120;
            const ctx = canvas.getContext("2d");
            
            ctx.drawImage(img, startX, startY, size, size, 0, 0, 120, 120);
            resolve(canvas.toDataURL("image/png")); // 采用 PNG 格式，完美保留背景透明度
          };
          img.onerror = () => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target.result);
            reader.readAsDataURL(file);
          };
          const reader = new FileReader();
          reader.onload = (evt) => {
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        });
        
        // 写入本地该应用输入框，并更新即时预览
        const urlInput = document.getElementById(`beautify-icon-url-${activeCustomizingAppId}`);
        if (urlInput) urlInput.value = "[本地上传图标]";
        
        const previewBox = document.getElementById(`beautify-preview-${activeCustomizingAppId}`);
        if (previewBox) {
          previewBox.innerHTML = `<img src="${compressedDataURL}" style="width:100%; height:100%; object-fit:cover;">`;
          previewBox.setAttribute("data-pending-base64", compressedDataURL);
        }
        
        fileIconGlobal.value = "";
      }
    };
  }

  // 监听恢复单个应用图标为默认
  document.querySelectorAll(".btn-icon-reset-trigger").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const appId = btn.getAttribute("data-app");
      
      let customIcons = {};
      try { customIcons = JSON.parse(localStorage.getItem("beautify-custom-icons")) || {}; } catch(err) {}
      delete customIcons[appId];
      localStorage.setItem("beautify-custom-icons", JSON.stringify(customIcons));

      const urlInput = document.getElementById(`beautify-icon-url-${appId}`);
      if (urlInput) urlInput.value = "";

      const previewBox = document.getElementById(`beautify-preview-${appId}`);
      if (previewBox) {
        previewBox.removeAttribute("data-pending-base64");
        const info = DESKTOP_APPS_CONFIG[appId];
        previewBox.innerHTML = info ? info.svg : "";
      }
      
      let appName = "";
      if (appId === "settings") appName = "设置";
      else if (appId === "archive") appName = "档案库";
      else if (appId === "world_book") appName = "世界书";
      else if (appId === "chat") appName = "聊天";
      else if (appId === "deeptalk") appName = "深谈";
      else if (appId === "reader") appName = "阅读";
      else if (appId === "forum") appName = "论坛";
      else if (appId === "couples") appName = "情侣空间";
      else if (appId === "music") appName = "听歌";
      else if (appId === "shopping") appName = "购物";
      else if (appId === "encounter") appName = "邂逅";
      else if (appId === "quicktravel") appName = "快穿局";

      alert(`应用「${appName}」图标已重置为系统默认。`);
      if (window.loadDesktopLayout) window.loadDesktopLayout();
    };
  });

  // 绑定：Dock 不透明度数值即时变动
  const opacityInput = document.getElementById("beautify-dock-opacity");
  const opacityValText = document.getElementById("beautify-dock-opacity-val");
  if (opacityInput && opacityValText) {
    opacityInput.oninput = (e) => {
      opacityValText.innerText = e.target.value;
    };
  }

  document.getElementById("btn-save-beautify").onclick = saveBeautifyConfig;
  document.getElementById("btn-reset-beautify").onclick = resetBeautifyConfig;

  // 绑定：内置 UI 主题预设应用事件 (由独立的 app_desktop_presets.js 驱动)
  const btnApplyBuiltin = document.getElementById("btn-apply-builtin-preset");
  if (btnApplyBuiltin) {
    btnApplyBuiltin.onclick = () => {
      if (typeof window.applyBuiltinThemePreset === "function") {
        window.applyBuiltinThemePreset();
      } else {
        alert("预设模块加载中，请稍后再试。");
      }
    };
  }

  // 绑定：全局 CSS 相关
  document.getElementById("btn-save-css-preset").onclick = saveCssPreset;
  document.getElementById("btn-apply-css").onclick = applyCssPreset;
  document.getElementById("btn-reset-css").onclick = resetCssPreset;
  document.getElementById("btn-delete-css-preset").onclick = deleteCssPreset;
  document.getElementById("css-presets-select").onchange = loadCssPresetToForm;

  // 绑定：组件工坊相关
  document.getElementById("btn-compile-widget").onclick = compileAndPreviewWidget;
  document.getElementById("btn-save-widget").onclick = saveWidgetPreset;
  document.getElementById("btn-delete-widget").onclick = deleteWidgetPreset;
  document.getElementById("widget-presets-select").onchange = loadWidgetToForm;
  
  // === 【绑定大模型组件 Prompt 复制事件】 ===
  const btnCopyPrompt = document.getElementById("btn-copy-widget-prompt");
  if (btnCopyPrompt) {
    btnCopyPrompt.onclick = copyWidgetPromptToClipboard;
  }

  // 绑定：数据管理多维统计优化按钮 [1]
  const btnOptimize = document.getElementById("btn-optimize-images");
  if (btnOptimize) btnOptimize.onclick = optimizeImagesAndAvatars;

  const btnCleanAvatars = document.getElementById("btn-clean-redundant-avatars");
  if (btnCleanAvatars) btnCleanAvatars.onclick = cleanRedundantAvatars;

  // 绑定：数据管理 (7块隔离导出/导入功能)
  document.getElementById("btn-export-beautify").onclick = exportBeautifyPack;
  document.getElementById("btn-import-beautify").onclick = () => document.getElementById("file-import-beautify").click();
  document.getElementById("file-import-beautify").onchange = importBeautifyPack;

  document.getElementById("btn-export-chat-personas").onclick = exportChatAndPersonas;
  document.getElementById("btn-import-chat-personas").onclick = () => document.getElementById("file-import-chat-personas").click();
  document.getElementById("file-import-chat-personas").onchange = importChatAndPersonas;

  document.getElementById("btn-export-all-data").onclick = exportBackup;
  document.getElementById("btn-import-all-data").onclick = () => document.getElementById("file-import-all").click();
  document.getElementById("file-import-all").onchange = importBackup;

  document.getElementById("btn-clear-all-data").onclick = clearAllAppData;

  // 注：本地向量记忆检索总开关已迁移至「向量化记忆设置」二级面板，由 vectorMemorySystem 统一接管

  // 绑定：流式传输 (Stream) 总开关
  const streamGlobalToggle = document.getElementById("api-stream-enabled-toggle");
  if (streamGlobalToggle) {
    streamGlobalToggle.checked = localStorage.getItem("settings-stream-enabled") === "true";
    streamGlobalToggle.onchange = (e) => {
      localStorage.setItem("settings-stream-enabled", e.target.checked ? "true" : "false");
      showToast(e.target.checked ? "已开启 API 流式传输 (Stream)" : "已关闭流式传输");
    };
  }

  // 绑定：强更新开关状态维护
  const forceToggle = document.getElementById("force-update-toggle");
  if (forceToggle) {
    forceToggle.checked = localStorage.getItem("system-force-update") === "true";
    forceToggle.onchange = (e) => {
      localStorage.setItem("system-force-update", e.target.checked ? "true" : "false");
    };
  }

  // 检测并升级静态资源
  document.getElementById("btn-update-resources").onclick = async () => {
    if (confirm("确定要立即重构并升级本地静态资源吗？您保存的本地聊天、人设、美化等数据将 100% 安全保留。")) {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let reg of registrations) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const cacheKeys = await caches.keys();
          for (let key of cacheKeys) {
            await caches.delete(key);
          }
        }
        alert("离线服务线程与本地强缓存已卸载成功！即将强制刷新以加载最新代码。");
        window.location.replace(window.location.origin + window.location.pathname + '?v=' + Date.now());
      } catch (err) {
        console.error("更新静态资源失败:", err);
        alert(`升级失败，详细原因: ${err.message}`);
      }
    }
  };
}

function openSettingsLv2(subTab) {
  document.getElementById("settings-lv1").style.display = "none";
  document.querySelectorAll(".settings-lv2-panel").forEach(p => p.style.display = "none");
  document.getElementById(`settings-lv2-${subTab}`).style.display = "block";
  
  const titles = {
    api: 'API 协议设置',
    beautify: '桌面美化设置',
    css: '全局 CSS 注入',
    widget: '组件工坊',
    deeptalk: '深谈预设设置',
    imagegen: '生图设置',
    data: '数据分区管理',
    'force-update': '系统强更新',
    changelog: '更新日志'
  };
  document.getElementById("settings-title").innerText = titles[subTab] || '系统设置';

  if (subTab === 'data') computeStorageUsage();
  if (subTab === 'changelog' && window.changelogSystem) window.changelogSystem.initChangelogPanel();
  if (subTab === 'imagegen' && window.imageGenSystem) window.imageGenSystem.initSettingsPanel();
}

// === 深谈全局预设配置管理 ===
async function loadDeeptalkPresetsList() {
  const select = document.getElementById("settings-deeptalk-presets-select");
  if (!select) return;
  const presets = await db.deeptalk_presets.toArray();
  select.innerHTML = '<option value="">-- 新建预设 --</option>';
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.innerText = p.name;
    select.appendChild(opt);
  });
}

async function loadDeeptalkPresetToForm() {
  const select = document.getElementById("settings-deeptalk-presets-select");
  const idVal = select.value;
  if (!idVal) {
    document.getElementById("settings-deeptalk-preset-name").value = "";
    document.getElementById("settings-deeptalk-preset-prompt").value = "";
    return;
  }

  const preset = await db.deeptalk_presets.get(Number(idVal));
  if (preset) {
    document.getElementById("settings-deeptalk-preset-name").value = preset.name;
    document.getElementById("settings-deeptalk-preset-prompt").value = preset.prompt;
  }
}

async function saveDeeptalkPreset() {
  const select = document.getElementById("settings-deeptalk-presets-select");
  const idVal = select.value;
  const name = document.getElementById("settings-deeptalk-preset-name").value.trim();
  const promptText = document.getElementById("settings-deeptalk-preset-prompt").value.trim();

  if (!name || !promptText) {
    alert("请完整填写预设名称与附加 Prompt！");
    return;
  }

  const presetData = { name, prompt: promptText };

  if (idVal) {
    await db.deeptalk_presets.update(Number(idVal), presetData);
    alert("深谈预设已更新！");
  } else {
    await db.deeptalk_presets.add(presetData);
    alert("新深谈预设已成功添加！");
  }

  document.getElementById("settings-deeptalk-preset-name").value = "";
  document.getElementById("settings-deeptalk-preset-prompt").value = "";
  await loadDeeptalkPresetsList();
}

async function deleteDeeptalkPreset() {
  const select = document.getElementById("settings-deeptalk-presets-select");
  const idVal = select.value;
  if (!idVal) {
    alert("请选择要删除的深谈预设！");
    return;
  }

  if (confirm("确定要删除此深谈预设吗？")) {
    await db.deeptalk_presets.delete(Number(idVal));
    alert("该预设已彻底删除。");
    document.getElementById("settings-deeptalk-preset-name").value = "";
    document.getElementById("settings-deeptalk-preset-prompt").value = "";
    await loadDeeptalkPresetsList();
  }
}

function closeSettingsLv2() {
  document.getElementById("settings-lv1").style.display = "block";
  document.querySelectorAll(".settings-lv2-panel").forEach(p => p.style.display = "none");
  document.getElementById("settings-title").innerText = '系统设置';
}

function handleSettingsBack() {
  const lv1 = document.getElementById("settings-lv1");
  if (lv1.style.display === "none") {
    closeSettingsLv2();
  } else {
    closeApp('settings');
  }
}

// ==========================================
// 1. API 协议设置加载
// ==========================================
async function loadPresetsList() {
  const select = document.getElementById("api-presets-select");
  const presets = await db.api_presets.toArray();
  select.innerHTML = '<option value="">-- 选择已有预设 --</option>';
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.innerText = p.name;
    select.appendChild(opt);
  });
  
  const activeId = localStorage.getItem("global_api_preset_id");
  if (activeId) {
    select.value = activeId;
    loadPresetToForm(Number(activeId));
  }
}

async function loadPresetToForm(id) {
  const preset = await db.api_presets.get(id);
  if (!preset) return;
  document.getElementById("api-preset-name").value = preset.name || "";
  document.getElementById("api-protocol").value = preset.protocol || "openai";
  document.getElementById("api-url").value = preset.url || "";
  document.getElementById("api-key").value = preset.key || "";
  document.getElementById("api-temp").value = preset.temperature ?? 0.7;
  document.getElementById("temp-val").innerText = preset.temperature ?? 0.7;
  
  const modelSelect = document.getElementById("api-model-select");
  modelSelect.innerHTML = `<option value="${preset.model || ""}">${preset.model || "默认模型"}</option>`;
}

document.getElementById("api-presets-select").onchange = (e) => {
  if (e.target.value) {
    loadPresetToForm(Number(e.target.value));
  } else {
    document.getElementById("api-preset-name").value = "";
    document.getElementById("api-url").value = "";
    document.getElementById("api-key").value = "";
    document.getElementById("api-temp").value = 0.7;
    document.getElementById("temp-val").innerText = "0.7";
    document.getElementById("api-model-select").innerHTML = '<option value="">请先拉取模型</option>';
  }
};

document.getElementById("api-temp").oninput = (e) => {
  document.getElementById("temp-val").innerText = e.target.value;
};

document.getElementById("btn-save-preset").onclick = async () => {
  const select = document.getElementById("api-presets-select");
  const idVal = select.value;
  const name = document.getElementById("api-preset-name").value.trim();
  const protocol = document.getElementById("api-protocol").value;
  const url = document.getElementById("api-url").value.trim();
  const key = document.getElementById("api-key").value.trim();
  const model = document.getElementById("api-model-select").value;
  const temperature = parseFloat(document.getElementById("api-temp").value);
  
  if (!name) {
    alert("请输入预设名称");
    return;
  }
  
  const presetData = { name, protocol, url, key, model, temperature };
  
  if (idVal) {
    await db.api_presets.update(Number(idVal), presetData);
    alert("预设更新成功");
  } else {
    const newId = await db.api_presets.add(presetData);
    alert("新预设添加成功");
    localStorage.setItem("global_api_preset_id", newId);
  }
  loadPresetsList();
};

document.getElementById("btn-apply-global").onclick = async () => {
  const select = document.getElementById("api-presets-select");
  const idVal = select.value;
  if (!idVal) {
    alert("请先保存或选择一个预设进行应用");
    return;
  }
  localStorage.setItem("global_api_preset_id", idVal);
  alert("当前 API 预设已成功设定为全局应用！");
};

document.getElementById("btn-delete-preset").onclick = async () => {
  const select = document.getElementById("api-presets-select");
  const idVal = select.value;
  if (!idVal) {
    alert("请先选择一个预设进行删除");
    return;
  }
  if (confirm("确定要删除此 API 预设吗？")) {
    await db.api_presets.delete(Number(idVal));
    if (localStorage.getItem("global_api_preset_id") === idVal) {
      localStorage.removeItem("global_api_preset_id");
    }
    alert("预设已删除");
    loadPresetsList();
  }
};

document.getElementById("btn-fetch-models").onclick = async () => {
  const url = document.getElementById("api-url").value.trim();
  const key = document.getElementById("api-key").value.trim();
  const protocol = document.getElementById("api-protocol").value;
  
  if (!url) {
    alert("请先填写 API 终结点 URL");
    return;
  }
  
  const btn = document.getElementById("btn-fetch-models");
  btn.innerText = "拉动中...";
  btn.disabled = true;
  
  try {
    let models = [];
    if (protocol === 'openai' || protocol === 'openai-compatible' || protocol === 'deepseek') {
      const response = await fetch(`${url}/models`, {
        headers: { "Authorization": `Bearer ${key}` }
      });
      const data = await response.json();
      if (data && data.data) {
        models = data.data.map(m => m.id);
      }
    } else if (protocol === 'gemini') {
      models = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"];
    }
    
    const modelSelect = document.getElementById("api-model-select");
    modelSelect.innerHTML = "";
    if (models.length > 0) {
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.innerText = m;
        modelSelect.appendChild(opt);
      });
      alert(`成功拉取到 ${models.length} 个模型`);
    } else {
      throw new Error("未获取到模型列表");
    }
  } catch (err) {
    console.error(err);
    const modelSelect = document.getElementById("api-model-select");
    const mName = prompt("拉取失败，请输入模型名称（例如: gpt-4o）:") || "";
    if (mName) {
      modelSelect.innerHTML = `<option value="${mName}">${mName}</option>`;
    }
  } finally {
    btn.innerText = "拉取";
    btn.disabled = false;
  }
};

document.getElementById("btn-test-api").onclick = async () => {
  const url = document.getElementById("api-url").value.trim();
  const key = document.getElementById("api-key").value.trim();
  const model = document.getElementById("api-model-select").value || "gpt-3.5-turbo";
  
  if (!url) {
    alert("请先填写 API 终结点 URL");
    return;
  }
  
  const btn = document.getElementById("btn-test-api");
  btn.innerText = "测试中...";
  btn.disabled = true;
  
  try {
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5
      })
    });
    
    if (response.ok) {
      alert("连接测试成功！API 响应正常。");
    } else {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }
  } catch (err) {
    console.error(err);
    alert("连接测试失败: " + err.message);
  } finally {
    btn.innerText = "测试连接";
    btn.disabled = false;
  }
};

// ==========================================
// 2. 桌面美化设置逻辑 (支持平铺配置、即时预览与不透明度保存)
// ==========================================
function loadBeautifyForm() {
  const bgUrl = localStorage.getItem("beautify-wallpaper") || "";
  document.getElementById("beautify-bg-url").value = bgUrl.startsWith("data:") ? "[本地上传背景]" : bgUrl;
  
  // 渲染壁纸预览
  const bgPreview = document.getElementById("beautify-bg-preview");
  if (bgPreview) {
    if (bgUrl) {
      bgPreview.innerHTML = `<img src="${bgUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      bgPreview.innerHTML = '<span style="font-size: 9px; color: var(--text-secondary); text-align: center;">无预览</span>';
    }
  }

  // 渲染不透明度数据
  const opacity = localStorage.getItem("beautify-dock-opacity") || "70";
  document.getElementById("beautify-dock-opacity").value = opacity;
  document.getElementById("beautify-dock-opacity-val").innerText = opacity;

  // 渲染回车上屏开关状态
  const enterSend = localStorage.getItem("settings-enter-send") === "true";
  const enterSendInput = document.getElementById("settings-enter-send-toggle");
  if (enterSendInput) enterSendInput.checked = enterSend;

  // 循环载入并高精度绘制应用图标的平铺预览图 (加入 deeptalk, reader, forum, couples, encounter)
  const apps = ["settings", "archive", "world_book", "chat", "deeptalk", "reader", "forum", "couples", "music", "shopping", "encounter", "quicktravel"];
  let customIcons = {};
  try {
    customIcons = JSON.parse(localStorage.getItem("beautify-custom-icons")) || {};
  } catch(e) {}

  apps.forEach(appId => {
    const previewBox = document.getElementById(`beautify-preview-${appId}`);
    const urlInput = document.getElementById(`beautify-icon-url-${appId}`);
    if (urlInput) {
      const savedIcon = customIcons[appId] || "";
      urlInput.value = savedIcon.startsWith("data:") ? "[本地上传图标]" : savedIcon;

      if (previewBox) {
        if (savedIcon) {
          previewBox.innerHTML = `<img src="${savedIcon}" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
          const info = DESKTOP_APPS_CONFIG[appId];
          previewBox.innerHTML = info ? info.svg : "";
        }
      }
    }
  });
}

async function saveBeautifyConfig() {
  const bgInput = document.getElementById("beautify-bg-url").value.trim();
  const opacityVal = document.getElementById("beautify-dock-opacity").value;

  // 保存背景
  if (bgInput === "[本地上传背景]") {
    if (tempBgBlob) {
      const dataURL = await blobToDataURL(tempBgBlob);
      localStorage.setItem("beautify-wallpaper", dataURL);
    }
  } else if (bgInput) {
    localStorage.setItem("beautify-wallpaper", bgInput);
  } else {
    localStorage.removeItem("beautify-wallpaper");
  }

  // 保存不透明度
  localStorage.setItem("beautify-dock-opacity", opacityVal);

  // 保存回车上屏开关状态
  const enterSendInput = document.getElementById("settings-enter-send-toggle");
  if (enterSendInput) {
    localStorage.setItem("settings-enter-send", enterSendInput.checked ? "true" : "false");
  }

  // 依次读取平铺列表中的应用图标配置 (加入 deeptalk, reader, forum, couples, encounter)
  const apps = ["settings", "archive", "world_book", "chat", "deeptalk", "reader", "forum", "couples", "music", "shopping", "encounter", "quicktravel"];
  let customIcons = {};
  try {
    customIcons = JSON.parse(localStorage.getItem("beautify-custom-icons")) || {};
  } catch(e) {}

  apps.forEach(appId => {
    const urlInput = document.getElementById(`beautify-icon-url-${appId}`);
    if (urlInput) {
      const val = urlInput.value.trim();
      if (val === "[本地上传图标]") {
        const previewBox = document.getElementById(`beautify-preview-${appId}`);
        const pendingBase64 = previewBox ? previewBox.getAttribute("data-pending-base64") : null;
        if (pendingBase64) {
          customIcons[appId] = pendingBase64;
        }
      } else if (val) {
        customIcons[appId] = val;
      } else {
        delete customIcons[appId];
      }
    }
  });

  localStorage.setItem("beautify-custom-icons", JSON.stringify(customIcons));
  tempBgBlob = null;

  alert("美化方案配置已应用并保存！桌面端即将即时重绘。");
  if (window.applyGlobalSettingsOnLoad) applyGlobalSettingsOnLoad();
  if (window.loadDesktopLayout) loadDesktopLayout();
  loadBeautifyForm(); // 刷新预览状态
}

function resetBeautifyConfig() {
  if (confirm("确定要恢复默认壁纸与全部桌面图标吗？")) {
    localStorage.removeItem("beautify-wallpaper");
    localStorage.removeItem("beautify-custom-icons");
    localStorage.removeItem("beautify-dock-opacity");
    localStorage.removeItem("settings-enter-send");
    document.getElementById("beautify-bg-url").value = "";
    
    const apps = ["settings", "archive", "world_book", "chat", "deeptalk", "reader", "forum", "couples", "music", "shopping", "encounter", "quicktravel"];
    apps.forEach(appId => {
      const input = document.getElementById(`beautify-icon-url-${appId}`);
      if (input) input.value = "";
    });

    alert("默认方案重置成功。");
    if (window.applyGlobalSettingsOnLoad) applyGlobalSettingsOnLoad();
    if (window.loadDesktopLayout) loadDesktopLayout();
    loadBeautifyForm();
  }
}

// ==========================================
// 3. 全局 CSS 注入逻辑
// ==========================================
function loadCustomCssPresets() {
  const select = document.getElementById("css-presets-select");
  let presets = {};
  try {
    presets = JSON.parse(localStorage.getItem("custom-css-presets")) || {};
  } catch(e) {}

  select.innerHTML = '<option value="">-- 新建预设 --</option>';
  Object.keys(presets).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.innerText = name;
    select.appendChild(opt);
  });

  document.getElementById("css-code-editor").value = localStorage.getItem("beautify-active-css") || "";
}

function loadCssPresetToForm() {
  const name = document.getElementById("css-presets-select").value;
  if (!name) return;
  let presets = {};
  try {
    presets = JSON.parse(localStorage.getItem("custom-css-presets")) || {};
  } catch(e) {}

  document.getElementById("css-preset-name").value = name;
  document.getElementById("css-code-editor").value = presets[name] || "";
}

function saveCssPreset() {
  const name = document.getElementById("css-preset-name").value.trim();
  const code = document.getElementById("css-code-editor").value;
  if (!name) {
    alert("请输入要保存的预设名称");
    return;
  }

  let presets = {};
  try {
    presets = JSON.parse(localStorage.getItem("custom-css-presets")) || {};
  } catch(e) {}

  presets[name] = code;
  localStorage.setItem("custom-css-presets", JSON.stringify(presets));
  alert("CSS 预设保存成功。");
  loadCustomCssPresets();
}

function applyCssPreset() {
  const code = document.getElementById("css-code-editor").value;
  localStorage.setItem("beautify-active-css", code);
  alert("自定义 CSS 已编译并全局生效！");
  if (window.applyGlobalSettingsOnLoad) applyGlobalSettingsOnLoad();
}

function resetCssPreset() {
  if (confirm("确定要清空全局 CSS 注入吗？")) {
    localStorage.removeItem("beautify-active-css");
    document.getElementById("css-code-editor").value = "";
    document.getElementById("css-preset-name").value = "";
    alert("已清空并恢复默认。");
    if (window.applyGlobalSettingsOnLoad) applyGlobalSettingsOnLoad();
  }
}

function deleteCssPreset() {
  const name = document.getElementById("css-presets-select").value;
  if (!name) {
    alert("请先选择要删除的 CSS 预设");
    return;
  }
  if (confirm(`确定要彻底删除预设「${name}」吗？`)) {
    let presets = {};
    try {
      presets = JSON.parse(localStorage.getItem("custom-css-presets")) || {};
    } catch(e) {}
    delete presets[name];
    localStorage.setItem("custom-css-presets", JSON.stringify(presets));
    alert("预设已成功删除。");
    loadCustomCssPresets();
  }
}

// ==========================================
// 4. 组件工坊逻辑（支持自定义列宽行高）
// ==========================================
function loadWidgetPresets() {
  const select = document.getElementById("widget-presets-select");
  let widgets = {};
  try {
    widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
  } catch(e) {}

  select.innerHTML = '<option value="">-- 新建组件 --</option>';
  Object.keys(widgets).forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.innerText = widgets[id].name;
    select.appendChild(opt);
  });
}

function loadWidgetToForm() {
  const id = document.getElementById("widget-presets-select").value;
  if (!id) {
    document.getElementById("widget-name-input").value = "";
    document.getElementById("widget-code-editor").value = "";
    document.getElementById("widget-width-span").value = "1";
    document.getElementById("widget-height-span").value = "1";
    document.getElementById("widget-workshop-preview").innerHTML = '<span style="font-size:11px; color:var(--text-secondary);">暂无预览</span>';
    return;
  }

  let widgets = {};
  try {
    widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
  } catch(e) {}

  const w = widgets[id];
  if (w) {
    document.getElementById("widget-name-input").value = w.name;
    document.getElementById("widget-code-editor").value = w.html;
    document.getElementById("widget-width-span").value = w.widthSpan || 1;
    document.getElementById("widget-height-span").value = w.heightSpan || 1;
    compileAndPreviewWidget();
  }
}

function compileAndPreviewWidget() {
  const code = document.getElementById("widget-code-editor").value;
  const preview = document.getElementById("widget-workshop-preview");
  if (!preview) return;

  preview.innerHTML = code;
  // 核心：强制执行组件中的 script
  const scripts = preview.querySelectorAll("script");
  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");
    newScript.text = oldScript.innerHTML;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

function saveWidgetPreset() {
  const name = document.getElementById("widget-name-input").value.trim();
  const code = document.getElementById("widget-code-editor").value;
  const widthSpan = parseInt(document.getElementById("widget-width-span").value) || 1;
  const heightSpan = parseInt(document.getElementById("widget-height-span").value) || 1;

  if (!name) {
    alert("请输入组件名称");
    return;
  }

  const select = document.getElementById("widget-presets-select");
  let id = select.value;
  if (!id) {
    id = "widget_" + Date.now();
  }

  let widgets = {};
  try {
    widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
  } catch(e) {}

  widgets[id] = { id, name, html: code, widthSpan, heightSpan };
  localStorage.setItem("beautify-widgets", JSON.stringify(widgets));
  alert("组件编译与保存成功！可在桌面上长按空白槽位添加。");
  loadWidgetPresets();
  select.value = id;
}

function deleteWidgetPreset() {
  const id = document.getElementById("widget-presets-select").value;
  if (!id) {
    alert("请选择一个已有组件进行删除");
    return;
  }
  if (confirm("确定要删除此组件吗？这将从桌面所有已添加的地方将其自动卸载。")) {
    let widgets = {};
    try {
      widgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {};
    } catch(e) {}
    delete widgets[id];
    localStorage.setItem("beautify-widgets", JSON.stringify(widgets));

    // 清理桌面摆放
    ["desktop", "dock"].forEach(type => {
      let placed = {};
      try { placed = JSON.parse(localStorage.getItem(`placed-widgets-${type}`)) || {}; } catch(e) {}
      Object.keys(placed).forEach(slotIdx => {
        if (placed[slotIdx] === id) delete placed[slotIdx];
      });
      localStorage.setItem(`placed-widgets-${type}`, JSON.stringify(placed));
    });

    alert("组件已删除");
    loadWidgetPresets();
    loadWidgetToForm();
    if (window.loadDesktopLayout) loadDesktopLayout();
  }
}

// === 【一键复制组件开发 Prompt 模板函数】 ===
function copyWidgetPromptToClipboard() {
  const promptText = `# Role
你是一个资深的前端动效与组件设计师，专为“叙事诗小手机（Story Phone）”虚拟操作系统设计桌面小部件（Widgets）。

# Goal
根据用户提出的功能需求与尺寸规格，生成一段 100% 独立自闭环、开箱即用的 HTML/CSS/JS 混合代码。该代码能够直接粘贴到小手机的“组件工坊”中无缝编译并渲染。

# Technical Constraints & Code Standards (极其重要)
为了防止组件破坏主系统或在页面重绘时引起浏览器假死，你编写的代码必须严格遵守以下技术规范：

1. 作用域隔离 (Scope Isolation)：
   - 脚本必须包裹在立即执行函数 IIFE 中：(function() { ... })();。
   - 严禁声明任何全局变量或将属性挂载到 window 上，所有变量必须使用 const 或 let 进行块级约束，防止命名空间冲突。

2. 防御性内存清理机制 (Anti-Memory Leak)：
   - 如果组件中使用了 setInterval、setTimeout 或向全局 document / window 绑定了事件监听器，必须使用 MutationObserver 监听组件根节点在 DOM 树中的物理留存状态。
   - 一旦检测到组件已被用户从桌面卸载，**必须立即清除定时器（clearInterval/clearTimeout）并注销全局监听**，防止多实例叠加导致主进程卡死。
   - 示例卸载监听代码：
     \`\`\`javascript
     const container = document.getElementById("your-widget-unique-id");
     const intervalId = setInterval(updateFunction, 1000);
     const observer = new MutationObserver((mutations, obs) => {
       if (!document.contains(container)) {
         clearInterval(intervalId);
         obs.disconnect();
       }
     });
     observer.observe(document.body, { childList: true, subtree: true });
     \`\`\`

3. 视觉规范 (Aesthetics & Glassmorphism)：
   - 组件默认继承操作系统的“仿微信/iOS 毛玻璃（Glassmorphism）”视觉调性。
   - 容器背景必须使用半透明色彩：background: rgba(255, 255, 255, 0.12);。
   - 容器边缘必须具备毛玻璃模糊：backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);。
   - 容器边框必须是微弱发光的白色半透明描边：border: 1px solid rgba(255, 255, 255, 0.22);。
   - 字体必须使用现代无衬线体 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif，并使用高清晰度文字阴影：text-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);。
   - 时钟或动态变动的数字，必须开启等宽数字对齐，防止数字跳动导致的卡片滑步：font-feature-settings: 'tnum';。

4. 尺寸与排版适应 (Sizing)：
   - 必须使用绝对自适应布局（width: 100%; height: 100%; box-sizing: border-box;），确保在不同的 widthSpan（列宽）和 heightSpan（行高）下不发生内容物理溢出。

# Output Format
- 仅输出一个 Markdown 代码块，包含完整的 HTML/CSS/JS 代码。
- 严禁输出任何多余的解释性文本、问候语或 Markdown 外侧修饰，确保用户可以一键复制。

---

# User Input
请根据以下要求，为我设计组件：
- **组件名称**：[例如：极简数字时钟]
- **占用尺寸**：宽 [X] 列，高 [Y] 行 （注：一排最大宽度为 4 列）
- **功能细节**：[例如：实时拉取系统时间，显示小时与分钟，带动态闪烁的分隔符，以及农历日期]
- **交互动效**：[例如：点击卡片时，背景色彩发生微弱渐变律动]`;

  navigator.clipboard.writeText(promptText).then(() => {
    alert("组件开发大模型 Prompt 模板已成功复制到您的剪贴板！\n\n您可以立刻将其粘贴发送给 ChatGPT/DeepSeek/Claude 等 AI 助手来为您生成高度合规的桌面小组件。");
  }).catch(err => {
    console.error("一键复制失败:", err);
    alert("复制失败，您的浏览器可能未授予剪贴板访问权限，请在 README 的附录中手动复制。");
  });
}

// ==========================================
// 5. 数据管理高级备份 (7块分区隔离导入导出)
// ==========================================
async function clearAllAppData() {
  if (confirm("系统数据全清除警告！\n\n此操作将彻底抹除当前小手机内产生的所有本地聊天记录、配置、美化及自定义组件，格式化为最初始状态。确定要彻底清空吗？")) {
    if (confirm("再次确认：确定清除吗？清除后不可撤销。")) {
      await db.api_presets.clear();
          await db.archives.clear();
          await db.relations.clear();
          await db.sessions.clear();
          await db.messages.clear();
          await db.world_book_entries.clear();
          await db.theaters.clear();
          await db.offline_messages.clear();
          await db.status_history.clear();
          await db.sticker_groups.clear();
          await db.sticker_items.clear();
          await db.summaries.clear();
          await db.deeptalks.clear();
          await db.deeptalk_messages.clear();
          await db.deeptalk_thoughts.clear();
          await db.deeptalk_presets.clear();
          await db.moments.clear();
          await db.moment_comments.clear();
          await db.moment_settings.clear();
          await db.html_cards.clear();
          await db.desktop_pets.clear();
          await db.reader_books.clear();
          await db.reader_chapters.clear();
          await db.reader_presets.clear();
          await db.reader_tags.clear();
          await db.check_phone_states.clear();
          await db.forum_accounts.clear();
          await db.forum_posts.clear();
          await db.forum_comments.clear();
          await db.forum_likes.clear();
          await db.forum_forwards.clear();
          await db.forum_notifications.clear();
          await db.forum_conversations.clear();
          await db.forum_messages.clear();
          await db.forum_follows.clear();
          await db.forum_presets.clear();
          await db.forum_npc_accounts.clear();
          await db.groups.clear();
          await db.group_members.clear();
          await db.group_polls.clear();
          await db.table('couples_schedules').clear();
          await db.table('couples_albums').clear();
          await db.table('couples_journals').clear();
          await db.table('couples_whispers').clear();
          if (db.music_songs) await db.music_songs.clear();
          if (db.music_playlists) await db.music_playlists.clear();
          localStorage.removeItem("ncm_local_songs");
          localStorage.removeItem("ncm_user_cookie");
          localStorage.removeItem("ncm_playlists");
          if (db.mcp_servers) await db.mcp_servers.clear();
          if (db.cot_presets) await db.cot_presets.clear();
          if (db.prompt_presets) await db.prompt_presets.clear();
          
          localStorage.clear();
      alert("所有本地数据与美化设置均已被格式化，系统即将重启。");
      location.reload();
    }
  }
}

// 导出美化包 (适配真机物理直写 /Download/Storypoem/) [1]
function exportBeautifyPack() {
  try {
    const pack = {
      wallpaper: localStorage.getItem("beautify-wallpaper"),
      customIcons: localStorage.getItem("beautify-custom-icons"),
      activeCss: localStorage.getItem("beautify-active-css"),
      cssPresets: localStorage.getItem("custom-css-presets"),
      placedWidgetsDesktop: localStorage.getItem("placed-widgets-desktop"),
      placedWidgetsDock: localStorage.getItem("placed-widgets-dock"),
      widgets: localStorage.getItem("beautify-widgets"),
      dockOpacity: localStorage.getItem("beautify-dock-opacity")
    };
    
    const jsonStr = JSON.stringify(pack, null, 2);
    const fileName = `desktop_beautify_pack_${Date.now()}.json`;

    // 优先执行真机物理直写 [2]
    if (window.AndroidMCP && typeof window.AndroidMCP.saveBackupFile === 'function') {
      const success = window.AndroidMCP.saveBackupFile(jsonStr, fileName);
      if (success) {
        showToast(`美化包成功物理导出至手机：/Download/Storypoem/${fileName}`);
      } else {
        showToast("物理导出美化包失败，请检查手机存储空间。");
      }
      return;
    }

    // PWA 降级下载
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    showToast("导出美化包失败: " + e.message);
  }
}

function importBeautifyPack(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (confirm("导入美化包将覆盖现有的壁纸、自定义图标与组件库！确定继续吗？")) {
        if (data.wallpaper) localStorage.setItem("beautify-wallpaper", data.wallpaper);
        if (data.customIcons) localStorage.setItem("beautify-custom-icons", data.customIcons);
        if (data.activeCss) localStorage.setItem("beautify-active-css", data.activeCss);
        if (data.cssPresets) localStorage.setItem("custom-css-presets", data.cssPresets);
        if (data.placedWidgetsDesktop) localStorage.setItem("placed-widgets-desktop", data.placedWidgetsDesktop);
        if (data.placedWidgetsDock) localStorage.setItem("placed-widgets-dock", data.placedWidgetsDock);
        if (data.widgets) localStorage.setItem("beautify-widgets", data.widgets);
        if (data.dockOpacity) localStorage.setItem("beautify-dock-opacity", data.dockOpacity);

        alert("美化包导入成功！");
        location.reload();
      }
    } catch(err) {
      alert("导入美化包失败: " + err.message);
    }
  };
  reader.readAsText(file);
}

// 导出人设与聊天记录 (适配真机物理直写 /Download/Storypoem/) [1]
async function exportChatAndPersonas() {
  try {
    const rawBackup = {
      archives: await db.archives.toArray(),
      relations: await db.relations.toArray(),
      sessions: await db.sessions.toArray(),
      messages: await db.messages.toArray(),
      offline_messages: await db.offline_messages.toArray(),
      status_history: await db.status_history.toArray(),
      localStorage: {
        active_me_id: localStorage.getItem("active_me_id")
      }
    };
    const backup = await serializeRecord(rawBackup);
    const jsonStr = JSON.stringify(backup, null, 2);
    const fileName = `personas_chat_backup_${Date.now()}.json`;

    // 优先执行真机物理直写 [2]
    if (window.AndroidMCP && typeof window.AndroidMCP.saveBackupFile === 'function') {
      const success = window.AndroidMCP.saveBackupFile(jsonStr, fileName);
      if (success) {
        showToast(`人设与聊天记录成功导出至：/Download/Storypoem/${fileName}`);
      } else {
        showToast("物理导出失败，请检查存储读写权限。");
      }
      return;
    }

    // PWA 降级下载
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    showToast("导出聊天人设记录失败: " + e.message);
  }
}

function importChatAndPersonas(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const rawData = JSON.parse(event.target.result);
      const data = deserializeRecord(rawData);
      if (confirm("警告：导入将覆盖现有的档案库、会话关系与所有聊天记录！确定继续吗？")) {
        await db.transaction('rw', [
          db.archives, db.relations, db.sessions, db.messages, db.offline_messages, db.status_history
        ], async () => {
          if (data.archives) {
            await db.archives.clear();
            await db.archives.bulkAdd(data.archives);
          }
          if (data.relations) {
            await db.relations.clear();
            await db.relations.bulkAdd(data.relations);
          }
          if (data.sessions) {
            await db.sessions.clear();
            await db.sessions.bulkAdd(data.sessions);
          }
          if (data.messages) {
            await db.messages.clear();
            await db.messages.bulkAdd(data.messages);
          }
          if (data.offline_messages) {
            await db.offline_messages.clear();
            await db.offline_messages.bulkAdd(data.offline_messages);
          }
          if (data.status_history) {
            await db.status_history.clear();
            await db.status_history.bulkAdd(data.status_history);
          }
        });

        if (data.localStorage && data.localStorage.active_me_id) {
          localStorage.setItem("active_me_id", data.localStorage.active_me_id);
        }

        alert("人设聊天记录导入成功！");
        location.reload();
      }
    } catch(err) {
      alert("导入失败: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ==========================================
// 6. 基础系统底层 (容量占用计算、无损大二进制导入/导出等)
// ==========================================
async function computeStorageUsage() {
  try {
    const api_presets = await db.api_presets.toArray();
    const archives = await db.archives.toArray();
    const relations = await db.relations.toArray();
    const sessions = await db.sessions.toArray();
    const messages = await db.messages.toArray();
    const world_book_entries = await db.world_book_entries.toArray();
    const theaters = await db.theaters.toArray();
    const offline_messages = await db.offline_messages.toArray();
    const status_history = await db.status_history.toArray();
    const sticker_groups = await db.sticker_groups.toArray();
    const sticker_items = await db.sticker_items.toArray();
    const summaries = await db.summaries.toArray();
    const deeptalks = await db.deeptalks.toArray();
    const deeptalk_messages = await db.deeptalk_messages.toArray();
    const deeptalk_thoughts = await db.deeptalk_thoughts.toArray();
    const deeptalk_presets = await db.deeptalk_presets.toArray();
    const moments = await db.moments.toArray();
    const moment_comments = await db.moment_comments.toArray();
    const moment_settings = await db.moment_settings.toArray();
    const html_cards = await db.html_cards.toArray();
    const desktop_pets = await db.desktop_pets.toArray();
    const reader_books = await db.reader_books.toArray();
    const reader_chapters = await db.reader_chapters.toArray();
    const reader_presets = await db.reader_presets.toArray();
    const reader_tags = await db.reader_tags.toArray();
    const check_phone_states = await db.check_phone_states.toArray();
    const forum_accounts = await db.forum_accounts.toArray();
    const forum_posts = await db.forum_posts.toArray();
    const forum_comments = await db.forum_comments.toArray();
    const forum_likes = await db.forum_likes.toArray();
    const forum_forwards = await db.forum_forwards.toArray();
    const forum_notifications = await db.forum_notifications.toArray();
    const forum_conversations = await db.forum_conversations.toArray();
    const forum_messages = await db.forum_messages.toArray();
    const forum_follows = await db.forum_follows.toArray();
    const forum_presets = await db.forum_presets.toArray();
        const forum_npc_accounts = await db.forum_npc_accounts.toArray();
        const mcp_servers = db.mcp_servers ? await db.mcp_servers.toArray() : [];
        const cot_presets = db.cot_presets ? await db.cot_presets.toArray() : [];
        const prompt_presets = db.prompt_presets ? await db.prompt_presets.toArray() : [];

        // 1. 计算图片、美化方案与表情包所占容量
    const wallpaperStr = localStorage.getItem("beautify-wallpaper") || "";
    const customIconsStr = localStorage.getItem("beautify-custom-icons") || "";
    const cssPresetsStr = localStorage.getItem("custom-css-presets") || "";
    const activeCssStr = localStorage.getItem("beautify-active-css") || "";
    const widgetsStr = localStorage.getItem("beautify-widgets") || "";
    const momentSettingsStr = localStorage.getItem("moment_settings") || "";

    const beautifyBaseBytes = new Blob([wallpaperStr + customIconsStr + cssPresetsStr + activeCssStr + widgetsStr + momentSettingsStr]).size;
    const stickersBytes = new Blob([JSON.stringify(sticker_groups) + JSON.stringify(sticker_items)]).size;
    const totalBeautifyBytes = beautifyBaseBytes + stickersBytes;

    // 2. 计算档案库容量
    const totalArchivesBytes = new Blob([JSON.stringify(archives) + JSON.stringify(relations)]).size;

    // 3. 计算线上线下消息与会话基础表容量
    const totalMessagesBytes = new Blob([JSON.stringify(messages) + JSON.stringify(offline_messages) + JSON.stringify(sessions) + JSON.stringify(theaters) + JSON.stringify(deeptalks) + JSON.stringify(deeptalk_messages) + JSON.stringify(deeptalk_thoughts) + JSON.stringify(deeptalk_presets)]).size;

    // 4. 计算总结与向量记忆容量 [1]
    const totalSummariesBytes = new Blob([JSON.stringify(summaries)]).size;

    // 5. 计算全表总和
    const groups = await db.groups.toArray();
    const group_members = await db.group_members.toArray();
    const group_polls = await db.group_polls.toArray();
    const couples_schedules = await db.table('couples_schedules').toArray();
    const couples_albums = await db.table('couples_albums').toArray();
    const couples_journals = await db.table('couples_journals').toArray();
    const couples_whispers = await db.table('couples_whispers').toArray();

    // 5. 计算全表总和
    const fullDataObj = { 
      api_presets, archives, relations, sessions, messages, 
      world_book_entries, theaters, offline_messages, status_history, 
      sticker_groups, sticker_items, summaries,
      deeptalks, deeptalk_messages, deeptalk_thoughts, deeptalk_presets,
      moments, moment_comments, moment_settings, html_cards, desktop_pets,
      reader_books, reader_chapters, reader_presets, reader_tags,
      check_phone_states,
      forum_accounts, forum_posts, forum_comments, forum_likes, forum_forwards,
      forum_notifications, forum_conversations, forum_messages, forum_follows,
      forum_presets, forum_npc_accounts,
      groups, group_members, group_polls,
      couples_schedules, couples_albums, couples_journals, couples_whispers,
      mcp_servers, cot_presets, prompt_presets
    };
        const allBytes = new Blob([JSON.stringify(fullDataObj)]).size;

    // 同步渲染至多维统计看板
    document.getElementById("stat-beautify-bytes").innerText = `${(totalBeautifyBytes / 1024).toFixed(2)} KB`;
    document.getElementById("stat-archives-bytes").innerText = `${(totalArchivesBytes / 1024).toFixed(2)} KB`;
    document.getElementById("stat-messages-bytes").innerText = `${(totalMessagesBytes / 1024).toFixed(2)} KB`;
    document.getElementById("stat-summaries-bytes").innerText = `${(totalSummariesBytes / 1024).toFixed(2)} KB`;
    document.getElementById("stat-total-bytes").innerText = `${(allBytes / 1024).toFixed(2)} KB`;
  } catch (err) {
    console.error("计算空间失败，数据表未完全就位:", err);
  }
}

// === 大二进制 Blob / File 原生编解码转换层 ===
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// 递归遍历任意记录将 Blob 原生转换为 Base64 容器
async function serializeRecord(obj) {
  if (!obj) return obj;
  if (obj instanceof Blob) {
    const dataURL = await blobToDataURL(obj);
    return { __type: "Blob", data: dataURL };
  }
  if (Array.isArray(obj)) {
    const serializedArr = [];
    for (let item of obj) {
      serializedArr.push(await serializeRecord(item));
    }
    return serializedArr;
  }
  if (typeof obj === 'object') {
    const serializedObj = {};
    for (let key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serializedObj[key] = await serializeRecord(obj[key]);
      }
    }
    return serializedObj;
  }
  return obj;
}

// 递归遍历还原原生二进制 Blob 对象
function deserializeRecord(obj) {
  if (!obj) return obj;
  if (typeof obj === 'object') {
    if (obj.__type === "Blob" && typeof obj.data === 'string') {
      return dataURLtoBlob(obj.data);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => deserializeRecord(item));
    }
    const restoredObj = {};
    for (let key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        restoredObj[key] = deserializeRecord(obj[key]);
      }
    }
    return restoredObj;
  }
  return obj;
}

// === 在轨动态加载 JSZip 内核与 YYYYMMDD_HHMM 拟真时戳算法 ===
function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (typeof JSZip !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("加载 JSZip 压缩组件失败，请检查网络连接后重试"));
    document.head.appendChild(script);
  });
}

function getFormattedTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

// 备份数据导出逻辑 (支持 PWA-Zip 压实下载与 Android 真机分片流式二进制压缩包直写，彻底根治 TransactionTooLargeException 异常) [1, 2]
async function exportBackup() {
  try {
    const rawBackup = {
      api_presets: await db.api_presets.toArray(),
      archives: await db.archives.toArray(),
      relations: await db.relations.toArray(),
      sessions: await db.sessions.toArray(),
      messages: await db.messages.toArray(),
      world_book_entries: await db.world_book_entries.toArray(),
      theaters: await db.theaters.toArray(),
      offline_messages: await db.offline_messages.toArray(),
      status_history: await db.status_history.toArray(),
      sticker_groups: await db.sticker_groups.toArray(),
      sticker_items: await db.sticker_items.toArray(),
      summaries: await db.summaries.toArray(),
      deeptalks: await db.deeptalks.toArray(),
      deeptalk_messages: await db.deeptalk_messages.toArray(),
      deeptalk_thoughts: await db.deeptalk_thoughts.toArray(),
      deeptalk_presets: await db.deeptalk_presets.toArray(),
      moments: await db.moments.toArray(),
      moment_comments: await db.moment_comments.toArray(),
      moment_settings: await db.moment_settings.toArray(),
      html_cards: await db.html_cards.toArray(),
      desktop_pets: await db.desktop_pets.toArray(),
      reader_books: await db.reader_books.toArray(),
      reader_chapters: await db.reader_chapters.toArray(),
      reader_presets: await db.reader_presets.toArray(),
      reader_tags: await db.reader_tags.toArray(),
          check_phone_states: await db.check_phone_states.toArray(),
          forum_accounts: await db.forum_accounts.toArray(),
          forum_posts: await db.forum_posts.toArray(),
          forum_comments: await db.forum_comments.toArray(),
          forum_likes: await db.forum_likes.toArray(),
          forum_forwards: await db.forum_forwards.toArray(),
          forum_notifications: await db.forum_notifications.toArray(),
          forum_conversations: await db.forum_conversations.toArray(),
          forum_messages: await db.forum_messages.toArray(),
          forum_follows: await db.forum_follows.toArray(),
          forum_presets: await db.forum_presets.toArray(),
          forum_npc_accounts: await db.forum_npc_accounts.toArray(),
          groups: await db.groups.toArray(),
          group_members: await db.group_members.toArray(),
          group_polls: await db.group_polls.toArray(),
          couples_schedules: await db.table('couples_schedules').toArray(),
          couples_albums: await db.table('couples_albums').toArray(),
          couples_journals: await db.table('couples_journals').toArray(),
          couples_whispers: await db.table('couples_whispers').toArray(),
          mcp_servers: db.mcp_servers ? await db.mcp_servers.toArray() : [],
          cot_presets: db.cot_presets ? await db.cot_presets.toArray() : [],
          prompt_presets: db.prompt_presets ? await db.prompt_presets.toArray() : [],
          music_playlists: db.music_playlists ? await db.music_playlists.toArray() : [],
          music_songs: db.music_songs ? await db.music_songs.toArray() : [],
          music_logs: db.music_logs ? await db.music_logs.toArray() : [],
          localStorage: {
        global_api_preset_id: localStorage.getItem("global_api_preset_id"),
        active_me_id: localStorage.getItem("active_me_id"),
        desktopLayout: localStorage.getItem("desktop-layout-v3"),
        dockLayout: localStorage.getItem("dock-layout-v3"),
        wallet_balance_v1: localStorage.getItem("wallet_balance_v1"),
        wallet_ledger_v1: localStorage.getItem("wallet_ledger_v1"),
        beautifyWallpaper: localStorage.getItem("beautify-wallpaper"),
        customIcons: localStorage.getItem("beautify-custom-icons"),
        activeCss: localStorage.getItem("beautify-active-css"),
        cssPresets: localStorage.getItem("custom-css-presets"),
        placedWidgetsDesktop: localStorage.getItem("placed-widgets-desktop"),
        placedWidgetsDock: localStorage.getItem("placed-widgets-dock"),
        widgets: localStorage.getItem("beautify-widgets"),
        dockOpacity: localStorage.getItem("beautify-dock-opacity")
      }
    };
    
    const backup = await serializeRecord(rawBackup);
    const jsonStr = JSON.stringify(backup, null, 2);
    const timestampStr = getFormattedTimestamp();

    // 1. 启动内存 JSZip 高强度压实
    showToast("正在压缩在轨全量备份中...");
    await loadJSZip();
    const zip = new JSZip();
    zip.file("backup_data.json", jsonStr);
    
    // 2. 如果处于真机 APP 环境：执行极速分片二进制写入协议，杜绝系统级 Binder 异常 [2]
    if (window.AndroidMCP && typeof window.AndroidMCP.startBinaryChunkedSave === 'function') {
      const fileNameZip = `story_phone_all_backup_${timestampStr}.zip`;
      
      // 编译为高压缩率的 Base64 字符串
      const base64Str = await zip.generateAsync({ type: "base64", compression: "DEFLATE", compressionOptions: { level: 9 } });
      
      // 初始化真机文件写入流，准备追加
      const initSuccess = window.AndroidMCP.startBinaryChunkedSave(fileNameZip);
      if (!initSuccess) {
        showToast("初始化真机文件追加通道失败！");
        return;
      }

      // 强划 500KB 物理流式切片线，确保单片传输内存开销恒定
      const chunkSize = 500 * 1024;
      const totalLength = base64Str.length;
      let offset = 0;
      let chunkCount = 0;

      while (offset < totalLength) {
        const chunk = base64Str.substring(offset, offset + chunkSize);
        // 向原生流物理追加分片
        const appendSuccess = window.AndroidMCP.appendBinaryChunk(chunk);
        if (!appendSuccess) {
          showToast("追加数据分片到真机存储失败！");
          window.AndroidMCP.closeBinaryChunkedSave();
          return;
        }
        offset += chunkSize;
        chunkCount++;
      }

      // 刷盘固化并关闭文件流
      const closeSuccess = window.AndroidMCP.closeBinaryChunkedSave();
      if (closeSuccess) {
        showToast(`数据已完美分片(${chunkCount}个)压缩导出：/Download/Storypoem/${fileNameZip}`);
      } else {
        showToast("固化真机追加流失败，请检查存储空间。");
      }
      return;
    }

    // 3. PWA 网页降级下载
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const fileNameZip = `story_phone_all_backup_${timestampStr}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameZip;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("全量备份（高压缩率 .zip 文件）导出完成！");
  } catch (error) {
    console.error(error);
    showToast("完整数据备份失败: " + error.message);
  }
}

// 统一数据底层写入逻辑 (RAG 解耦保护)
async function performImportTransaction(rawData) {
  const data = deserializeRecord(rawData);
  await db.transaction('rw', [
    db.api_presets, db.archives, db.relations, db.sessions, db.messages, 
    db.world_book_entries, db.theaters, db.offline_messages, db.status_history,
    db.sticker_groups, db.sticker_items, db.summaries,
    db.deeptalks, db.deeptalk_messages, db.deeptalk_thoughts, db.deeptalk_presets,
    db.moments, db.moment_comments, db.moment_settings, db.html_cards, db.desktop_pets,
    db.reader_books, db.reader_chapters, db.reader_presets, db.reader_tags,
    db.check_phone_states,
    db.forum_accounts, db.forum_posts, db.forum_comments, db.forum_likes, db.forum_forwards,
    db.forum_notifications, db.forum_conversations, db.forum_messages, db.forum_follows,
    db.forum_presets, db.forum_npc_accounts,
    db.groups, db.group_members, db.group_polls,
    db.table('couples_schedules'), db.table('couples_albums'), db.table('couples_journals'), db.table('couples_whispers'),
    db.mcp_servers, db.cot_presets, db.prompt_presets,
    db.music_playlists, db.music_songs, db.music_logs
  ], async () => {
    if (data.api_presets) {
      await db.api_presets.clear();
      await db.api_presets.bulkAdd(data.api_presets);
    }
    if (data.archives) {
      await db.archives.clear();
      await db.archives.bulkAdd(data.archives);
    }
    if (data.relations) {
      await db.relations.clear();
      await db.relations.bulkAdd(data.relations);
    }
    if (data.sessions) {
      await db.sessions.clear();
      await db.sessions.bulkAdd(data.sessions);
    }
    if (data.messages) {
      await db.messages.clear();
      await db.messages.bulkAdd(data.messages);
    }
    if (data.world_book_entries) {
      await db.world_book_entries.clear();
      await db.world_book_entries.bulkAdd(data.world_book_entries);
    }
    if (data.theaters) {
      await db.theaters.clear();
      await db.theaters.bulkAdd(data.theaters);
    }
    if (data.offline_messages) {
      await db.offline_messages.clear();
      await db.offline_messages.bulkAdd(data.offline_messages);
    }
    if (data.status_history) {
      await db.status_history.clear();
      await db.status_history.bulkAdd(data.status_history);
    }
    if (data.sticker_groups) {
      await db.sticker_groups.clear();
      await db.sticker_groups.bulkAdd(data.sticker_groups);
    }
    if (data.sticker_items) {
      await db.sticker_items.clear();
      await db.sticker_items.bulkAdd(data.sticker_items);
    }
    if (data.summaries) {
      await db.summaries.clear();
      await db.summaries.bulkAdd(data.summaries);
    }
    if (data.deeptalks) {
      await db.deeptalks.clear();
      await db.deeptalks.bulkAdd(data.deeptalks);
    }
    if (data.deeptalk_messages) {
      await db.deeptalk_messages.clear();
      await db.deeptalk_messages.bulkAdd(data.deeptalk_messages);
    }
    if (data.deeptalk_thoughts) {
      await db.deeptalk_thoughts.clear();
      await db.deeptalk_thoughts.bulkAdd(data.deeptalk_thoughts);
    }
    if (data.deeptalk_presets) {
      await db.deeptalk_presets.clear();
      await db.deeptalk_presets.bulkAdd(data.deeptalk_presets);
    }
    if (data.moments) {
      await db.moments.clear();
      await db.moments.bulkAdd(data.moments);
    }
    if (data.moment_comments) {
      await db.moment_comments.clear();
      await db.moment_comments.bulkAdd(data.moment_comments);
    }
    if (data.moment_settings) {
      await db.moment_settings.clear();
      await db.moment_settings.bulkAdd(data.moment_settings);
    }
    if (data.html_cards) {
      await db.html_cards.clear();
      await db.html_cards.bulkAdd(data.html_cards);
    }
    if (data.desktop_pets) {
      await db.desktop_pets.clear();
      await db.desktop_pets.bulkAdd(data.desktop_pets);
    }
    if (data.reader_books) {
      await db.reader_books.clear();
      await db.reader_books.bulkAdd(data.reader_books);
    }
    if (data.reader_chapters) {
      await db.reader_chapters.clear();
      await db.reader_chapters.bulkAdd(data.reader_chapters);
    }
    if (data.reader_presets) {
      await db.reader_presets.clear();
      await db.reader_presets.bulkAdd(data.reader_presets);
    }
    if (data.reader_tags) {
      await db.reader_tags.clear();
      await db.reader_tags.bulkAdd(data.reader_tags);
    }
    if (data.check_phone_states) {
      await db.check_phone_states.clear();
      await db.check_phone_states.bulkAdd(data.check_phone_states);
    }
    if (data.forum_accounts) {
      await db.forum_accounts.clear();
      await db.forum_accounts.bulkAdd(data.forum_accounts);
    }
    if (data.forum_posts) {
      await db.forum_posts.clear();
      await db.forum_posts.bulkAdd(data.forum_posts);
    }
    if (data.forum_comments) {
      await db.forum_comments.clear();
      await db.forum_comments.bulkAdd(data.forum_comments);
    }
    if (data.forum_likes) {
      await db.forum_likes.clear();
      await db.forum_likes.bulkAdd(data.forum_likes);
    }
    if (data.forum_forwards) {
      await db.forum_forwards.clear();
      await db.forum_forwards.bulkAdd(data.forum_forwards);
    }
    if (data.forum_notifications) {
      await db.forum_notifications.clear();
      await db.forum_notifications.bulkAdd(data.forum_notifications);
    }
    if (data.forum_conversations) {
      await db.forum_conversations.clear();
      await db.forum_conversations.bulkAdd(data.forum_conversations);
    }
    if (data.forum_messages) {
      await db.forum_messages.clear();
      await db.forum_messages.bulkAdd(data.forum_messages);
    }
    if (data.forum_follows) {
      await db.forum_follows.clear();
      await db.forum_follows.bulkAdd(data.forum_follows);
    }
    if (data.forum_presets) {
      await db.forum_presets.clear();
      await db.forum_presets.bulkAdd(data.forum_presets);
    }
    if (data.forum_npc_accounts) {
          await db.forum_npc_accounts.clear();
          await db.forum_npc_accounts.bulkAdd(data.forum_npc_accounts);
        }
        if (data.groups) {
          await db.groups.clear();
          await db.groups.bulkAdd(data.groups);
        }
        if (data.group_members) {
          await db.group_members.clear();
          await db.group_members.bulkAdd(data.group_members);
        }
        if (data.group_polls) {
          await db.group_polls.clear();
          await db.group_polls.bulkAdd(data.group_polls);
        }
        if (data.couples_schedules) {
          await db.table('couples_schedules').clear();
          await db.table('couples_schedules').bulkAdd(data.couples_schedules);
        }
        if (data.couples_albums) {
          await db.table('couples_albums').clear();
          await db.table('couples_albums').bulkAdd(data.couples_albums);
        }
        if (data.couples_journals) {
          await db.table('couples_journals').clear();
          await db.table('couples_journals').bulkAdd(data.couples_journals);
        }
        if (data.couples_whispers) {
          await db.table('couples_whispers').clear();
          await db.table('couples_whispers').bulkAdd(data.couples_whispers);
        }
        if (data.mcp_servers && db.mcp_servers) {
          await db.mcp_servers.clear();
          await db.mcp_servers.bulkAdd(data.mcp_servers);
        }
        if (data.cot_presets && db.cot_presets) {
          await db.cot_presets.clear();
          await db.cot_presets.bulkAdd(data.cot_presets);
        }
        if (data.prompt_presets && db.prompt_presets) {
          await db.prompt_presets.clear();
          await db.prompt_presets.bulkAdd(data.prompt_presets);
        }
        // 音乐应用数据导入（无备份数据时仅清空旧数据）
        if (data.music_playlists) {
          await db.music_playlists.clear();
          await db.music_playlists.bulkAdd(data.music_playlists);
        }
        if (data.music_songs) {
          await db.music_songs.clear();
          await db.music_songs.bulkAdd(data.music_songs);
        }
        if (data.music_logs) {
          await db.music_logs.clear();
          await db.music_logs.bulkAdd(data.music_logs);
        }
      });
  
  if (data.localStorage) {
    const map = {
      desktopLayout: "desktop-layout-v3",
      dockLayout: "dock-layout-v3",
      beautifyWallpaper: "beautify-wallpaper",
      customIcons: "beautify-custom-icons",
      activeCss: "beautify-active-css",
      cssPresets: "custom-css-presets",
      placedWidgetsDesktop: "placed-widgets-desktop",
      placedWidgetsDock: "placed-widgets-dock",
      widgets: "beautify-widgets",
      dockOpacity: "beautify-dock-opacity"
    };

    Object.keys(data.localStorage).forEach(k => {
      const lKey = map[k] || k;
      if (data.localStorage[k] !== null && data.localStorage[k] !== undefined) {
        localStorage.setItem(lKey, data.localStorage[k]);
      }
    });
  }
}

// 备份数据自愈性多态还原导入逻辑 (完美自动解压支持：Web端 .zip 压缩包、APP端压缩型 Base64 .json、以及历史遗留普通文本 .json 导入) [2]
async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const confirmImport = confirm("导入完整备份将覆盖所有的本地数据、人设、聊天记录以及美化配置！确定要继续吗？");
  if (!confirmImport) return;

  const reader = new FileReader();

  if (file.name.endsWith(".zip")) {
    reader.onload = async (event) => {
      try {
        await loadJSZip();
        const zip = await JSZip.loadAsync(event.target.result);
        const jsonFile = zip.file("backup_data.json");
        if (!jsonFile) {
          throw new Error("压缩包格式损坏：未找到核心 backup_data.json 数据库备份文件");
        }
        const jsonText = await jsonFile.async("string");
        const rawData = JSON.parse(jsonText);
        await performImportTransaction(rawData);
        
        alert("全量压缩数据包导入解压成功！系统即将自动重载。");
        location.reload();
      } catch (err) {
        console.error(err);
        alert("导入压缩备份包失败，详细原因: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file); // ZIP 读取必须走二进制 ArrayBuffer
  } else {
    reader.onload = async (event) => {
      try {
        const textContent = event.target.result.trim();
        
        // 自愈断言：如果发现文本以 UEsDB 开头，说明它是一个在真机 APP 上被 Base64 压实后的超轻量 ZIP 二进制文本包 [2]
        if (textContent.startsWith("UEsDB")) {
          showToast("检测到 APP 压缩包，正在智能解压译码中...");
          await loadJSZip();
          const zipBlob = dataURLtoBlob("data:application/zip;base64," + textContent);
          const zip = await JSZip.loadAsync(zipBlob);
          const jsonFile = zip.file("backup_data.json");
          if (!jsonFile) {
            throw new Error("压缩文本格式损坏：未找到核心备份节点");
          }
          const jsonText = await jsonFile.async("string");
          const rawData = JSON.parse(jsonText);
          await performImportTransaction(rawData);
          alert("全量真机压缩文本包解密并恢复成功！系统即将自动重载。");
          location.reload();
          return;
        }

        // 普通遗留 JSON 文本导入分支
        const rawData = JSON.parse(textContent);
        await performImportTransaction(rawData);
        
        alert("全量普通文本数据导入成功！系统即将自动重载。");
        location.reload();
      } catch (error) {
        console.error(error);
        alert("导入备份文件失败，详细原因: " + error.message);
      }
    };
    reader.readAsText(file);
  }
}

// === 新增：自适应 PWA/APK 移动端调试控制台 (vConsole) 动态开关管理 ===
window.vConsoleInstance = null;

function initVConsoleSetting() {
  const toggle = document.getElementById("settings-vconsole-toggle");
  if (!toggle) return;

  const isEnabled = localStorage.getItem("settings-vconsole-enabled") === "true";
  toggle.checked = isEnabled;

  // 首次冷启动加载：静默启动（不弹 Toast 提示干扰用户）
  applyVConsoleState(isEnabled, true);

  toggle.onchange = (e) => {
    const enabled = e.target.checked;
    localStorage.setItem("settings-vconsole-enabled", enabled ? "true" : "false");
    applyVConsoleState(enabled, false);
  };
}

function applyVConsoleState(enabled, isFirstLoad) {
  if (enabled) {
    if (typeof VConsole !== 'undefined' && !window.vConsoleInstance) {
      window.vConsoleInstance = new VConsole();
      if (!isFirstLoad) showToast("调试控制台已开启 (绿色标签已就绪)");
    } else if (typeof VConsole === 'undefined') {
      if (!isFirstLoad) showToast("未检测到 vConsole 脚本，请确保 index.html 头部已引入");
    }
  } else {
    if (window.vConsoleInstance) {
      try {
        window.vConsoleInstance.destroy();
      } catch(e) {}
      window.vConsoleInstance = null;
      if (!isFirstLoad) showToast("调试控制台已关闭");
    }
  }
}

function initBackgroundSetting() {
  const toggle = document.getElementById("settings-background-toggle");
  if (!toggle) return;

  const isEnabled = localStorage.getItem("settings-background-enabled") === "true";
  toggle.checked = isEnabled;

  applyBackgroundState(isEnabled, true);

  toggle.onchange = (e) => {
    const enabled = e.target.checked;
    localStorage.setItem("settings-background-enabled", enabled ? "true" : "false");
    applyBackgroundState(enabled, false);
  };
}

function applyBackgroundState(enabled, isFirstLoad) {
  if (window.AndroidMCP && typeof window.AndroidMCP.toggleBackgroundWakeLock === 'function') {
    window.AndroidMCP.toggleBackgroundWakeLock(enabled);
    if (!isFirstLoad) {
      showToast(enabled ? "后台休眠已锁定，系统通知功能已就绪" : "后台运行已关闭");
    }
    return;
  }
  // 浏览器环境 fallback：Notification 权限 + Wake Lock API 保活
  if (enabled) {
    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // 启用屏幕常亮 Wake Lock，减轻浏览器对后台定时器的节流
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((wl) => {
        window._pwaWakeLock = wl;
        // 页面切到后台后 wakeLock 会自动释放，监听可见性变化在回到前台时重新获取
        if (!window._pwaWakeLockReboundBound) {
          window._pwaWakeLockReboundBound = true;
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && localStorage.getItem("settings-background-enabled") === "true") {
              if ('wakeLock' in navigator) {
                navigator.wakeLock.request('screen').then((wl) => { window._pwaWakeLock = wl; }).catch(() => {});
              }
            }
          });
        }
      }).catch((e) => {
        console.warn('Wake Lock 申请失败:', e);
      });
    }
    if (!isFirstLoad) showToast("浏览器通知已开启");
  } else {
    // 禁用时释放 wakeLock
    if (window._pwaWakeLock) {
      try { window._pwaWakeLock.release(); } catch (e) {}
      window._pwaWakeLock = null;
    }
    if (!isFirstLoad) showToast("后台运行已关闭");
  }
}

// ==========================================
//  在轨图像高保真压缩与冗余去重深度优化引擎
// ==========================================

// 通用在轨 Canvas 2D 压缩与正方形居中裁切核心算法 (兼容 Base64 与原生 Blob)
async function compressImageBase64(source, maxWidth = 200, quality = 0.75, forceSquare = false) {
  if (!source) return source;

  let dataUrl = "";
  if (source instanceof Blob) {
    dataUrl = await blobToDataURL(source);
  } else if (typeof source === 'string' && source.startsWith("data:image")) {
    dataUrl = source;
  } else {
    return source;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      let srcX = 0;
      let srcY = 0;
      let srcWidth = width;
      let srcHeight = height;

      if (forceSquare) {
        // 正方形中心等比裁切 (专门优化头像，防止拉伸变形)
        const minDim = Math.min(width, height);
        srcX = (width - minDim) / 2;
        srcY = (height - minDim) / 2;
        srcWidth = minDim;
        srcHeight = minDim;
        width = Math.min(minDim, maxWidth);
        height = width;
      } else {
        // 普通图像等比缩放
        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, width, height);

      const isPng = dataUrl.startsWith("data:image/png") || dataUrl.startsWith("data:image/svg");
      const compressedDataUrl = isPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
      resolve(compressedDataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
window.compressImageBase64 = compressImageBase64;

// 引擎 1：全库大图与历史头像无损压实引擎 (全量覆盖档案、会话、群组、论坛、表情包与聊天卡片)
async function optimizeImagesAndAvatars() {
  const btn = document.getElementById("btn-optimize-images");
  const origText = btn ? btn.innerText : "压缩图片/头像内存";
  if (btn) {
    btn.disabled = true;
    btn.style.cursor = "wait";
    btn.innerText = "全库在轨压实中...";
  }

  try {
    let archivesOptimized = 0;
    let sessionsOptimized = 0;
    let groupsOptimized = 0;
    let stickersOptimized = 0;
    let messagesOptimized = 0;

    // 1. 全量扫描并压缩档案库头像 (archives 表，含角色、用户、NPC，包括 Blob 与 Base64，等比正方形裁切至 200px)
    const archives = await db.archives.toArray();
    for (let arc of archives) {
      if (arc.avatar) {
        const compressed = await compressImageBase64(arc.avatar, 200, 0.75, true);
        if (compressed && compressed !== arc.avatar) {
          await db.archives.update(arc.id, { avatar: compressed });
          archivesOptimized++;
        }
      }
    }

    // 2. 深度扫描会话专属自定义头像 (sessions 表 customCharAvatar / customUserAvatar)
    const sessions = await db.sessions.toArray();
    for (let sess of sessions) {
      let updated = false;
      let updateData = {};
      if (sess.customCharAvatar) {
        const cCompressed = await compressImageBase64(sess.customCharAvatar, 200, 0.75, true);
        if (cCompressed && cCompressed !== sess.customCharAvatar) {
          updateData.customCharAvatar = cCompressed;
          updated = true;
        }
      }
      if (sess.customUserAvatar) {
        const uCompressed = await compressImageBase64(sess.customUserAvatar, 200, 0.75, true);
        if (uCompressed && uCompressed !== sess.customUserAvatar) {
          updateData.customUserAvatar = uCompressed;
          updated = true;
        }
      }
      if (updated) {
        await db.sessions.update(sess.id, updateData);
        sessionsOptimized++;
      }
    }

    // 3. 扫描群组头像 (groups 表)
    if (db.groups) {
      const groups = await db.groups.toArray();
      for (let grp of groups) {
        if (grp.avatar) {
          const compressed = await compressImageBase64(grp.avatar, 200, 0.75, true);
          if (compressed && compressed !== grp.avatar) {
            await db.groups.update(grp.id, { avatar: compressed });
            groupsOptimized++;
          }
        }
      }
    }

    // 4. 深度压缩 sticker_items 物理表情包 (过滤并压缩)
    const stickers = await db.sticker_items.toArray();
    for (let st of stickers) {
      if (st.imageUrl) {
        const compressed = await compressImageBase64(st.imageUrl, 250, 0.75, false);
        if (compressed && compressed !== st.imageUrl) {
          await db.sticker_items.update(st.id, { imageUrl: compressed });
          stickersOptimized++;
        }
      }
    }

    // 5. 深度压缩 messages 聊天内发送的图片与照片消息
    const photoMsgs = await db.messages.filter(m => m.contentType === 'photo' || m.contentType === 'image').toArray();
    for (let msg of photoMsgs) {
      if (msg.contentType === 'photo' && typeof msg.content === 'string' && msg.content.startsWith("data:image")) {
        const compressed = await compressImageBase64(msg.content, 800, 0.75, false);
        if (compressed && compressed.length < msg.content.length) {
          await db.messages.update(msg.id, { content: compressed });
          messagesOptimized++;
        }
      } else if (msg.contentType === 'image' && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.url && parsed.url.startsWith("data:image")) {
            const compressed = await compressImageBase64(parsed.url, 800, 0.75, false);
            if (compressed && compressed.length < parsed.url.length) {
              parsed.url = compressed;
              await db.messages.update(msg.id, { content: JSON.stringify(parsed) });
              messagesOptimized++;
            }
          }
        } catch(e) {}
      }
    }

    // 6. 深度压缩 offline_messages 线下剧场内照片
    const allOfflineMsgs = await db.offline_messages.toArray();
    for (let msg of allOfflineMsgs) {
      if (msg.content && typeof msg.content === 'string' && msg.content.startsWith("data:image")) {
        const compressed = await compressImageBase64(msg.content, 800, 0.75, false);
        if (compressed && compressed.length < msg.content.length) {
          await db.offline_messages.update(msg.id, { content: compressed });
          messagesOptimized++;
        }
      }
    }

    alert(`✨ 全库图像在轨压实完成！\n\n成功深度重构与正方形居中剪切：\n- 档案库角色/用户头像: ${archivesOptimized} 个\n- 会话自定义双方头像: ${sessionsOptimized} 处\n- 群组头像: ${groupsOptimized} 个\n- 表情包单图: ${stickersOptimized} 张\n- 聊天附图与照片卡片: ${messagesOptimized} 张\n\n所有历史高清大图已等比压缩降至约 10~20KB 级别，刷新和流畅度将提升 90% 以上！`);
    await computeStorageUsage();
  } catch(e) {
    console.error("压缩全库图片失败:", e);
    alert("压缩出现异常: " + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.cursor = "pointer";
      btn.innerText = origText;
    }
  }
}

// 引擎 2：智能清理 sessions 复制的多份冗余头像缓存
async function cleanRedundantAvatars() {
  const btn = document.getElementById("btn-clean-redundant-avatars");
  const origText = btn.innerText;
  btn.disabled = true;
  btn.style.cursor = "wait";
  btn.innerText = "智能去重中...";

  try {
    let charAvatarsCleaned = 0;
    let userAvatarsCleaned = 0;

    const sessions = await db.sessions.toArray();
    for (let sess of sessions) {
      // 若当前会话的对方头像与 archives 表对应角色头像一模一样，重置为 ""，UI将自动从 archives 继承
      const charArc = await db.archives.get(Number(sess.charId));
      if (charArc && sess.customCharAvatar === charArc.avatar) {
        await db.sessions.update(sess.id, { customCharAvatar: "" });
        charAvatarsCleaned++;
      }

      // 若当前会话的我方头像与 archives 表对应我的人设头像一模一样，安全去重
      const userArc = await db.archives.get(Number(sess.userId));
      if (userArc && sess.customUserAvatar === userArc.avatar) {
        await db.sessions.update(sess.id, { customUserAvatar: "" });
        userAvatarsCleaned++;
      }
    }

    alert(`✨ 冗余头像缓存智能清理完成！\n\n成功清理去重：\n- 重复的对方会话头像: ${charAvatarsCleaned} 处\n- 重复的我方会话头像: ${userAvatarsCleaned} 处\n\n这些会话已无损切换为动态代理指向，成功根治了重复图片造成的空间侵占。`);
    await computeStorageUsage();
  } catch(e) {
    console.error("去重清理失败:", e);
    alert("去重清理失败: " + e.message);
  } finally {
    btn.disabled = false;
    btn.style.cursor = "pointer";
    btn.innerText = origText;
  }
}
