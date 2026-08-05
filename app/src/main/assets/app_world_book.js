let isWorldBookInitialized = false;

// 二进制安全解析器
function resolveAvatar(avatar) {
  if (!avatar) {
    // 关键修复：SVG 内部属性必须用单引号，否则双引号会提前闭合 <img src="..."> 的 src 属性，
    // 导致头像显示为破损图片，且剩余 SVG 标记（含 > 字符）泄漏到页面，造成名字带残破 > 字样
    return "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='50' fill='%23cbd5e1'/><text x='50' y='62' font-size='50' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif'>人</text></svg>";
  }
  if (avatar instanceof Blob) {
    return URL.createObjectURL(avatar);
  }
  return avatar;
}

function initWorldBookApp() {
  loadWorldBookData();

  if (isWorldBookInitialized) {
    return;
  }
  isWorldBookInitialized = true;

  // 绑定：开启添加条目表单
  document.getElementById("btn-add-world_book").onclick = () => {
    openWorldBookForm();
  };

  // 绑定：关闭表单表层
  document.getElementById("btn-close-wb-form").onclick = () => {
    document.getElementById("world_book-form-overlay").classList.remove("active");
  };
  document.getElementById("btn-cancel-wb-form").onclick = () => {
    document.getElementById("world_book-form-overlay").classList.remove("active");
  };

  // 存储或更新世界书设定
  document.getElementById("world_book-form").onsubmit = async (e) => {
    e.preventDefault();
    const idVal = document.getElementById("wb-entry-id").value;
    const id = idVal ? Number(idVal) : null;

    let group = document.getElementById("wb-entry-group").value.trim() || "默认分组";
    const title = document.getElementById("wb-entry-title").value.trim();
    const mode = document.getElementById("wb-entry-mode").value;
    const keywords = document.getElementById("wb-entry-keywords").value.trim();
    const probability = Math.min(100, Math.max(0, parseInt(document.getElementById("wb-entry-prob").value) || 100));
    const depth = Number(document.getElementById("wb-entry-depth").value) ?? 10;
    const content = document.getElementById("wb-entry-content").value.trim();

    const entryObj = {
      group,
      title,
      mode,
      keywords,
      probability,
      depth,
      content,
      isActive: mode !== 'disabled'
    };

    if (id) {
      await db.world_book_entries.update(id, entryObj);
    } else {
      await db.world_book_entries.add(entryObj);
    }

    document.getElementById("world_book-form-overlay").classList.remove("active");
    loadWorldBookData();
  };

  // 初始化世界书导入
  initWorldBookImport();
}

// 初始化世界书导入控制器
function initWorldBookImport() {
  const btnImport = document.getElementById("btn-world_book-import");
  const fileImport = document.getElementById("file-world_book-import");
  if (btnImport && fileImport) {
    btnImport.onclick = () => fileImport.click();
    fileImport.onchange = async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        showToast("正在解析世界书设定文件...");
        try {
          let text = "";
          if (file.name.endsWith(".docx")) {
            text = await parseDocxText(file);
          } else {
            text = await readTxtFileSafe(file);
          }

          // 打开新建表单并自动填充数据
          await openWorldBookForm();
          const defaultTitle = file.name.substring(0, file.name.lastIndexOf('.')) || "新世界书设定";
          document.getElementById("wb-entry-title").value = defaultTitle;
          document.getElementById("wb-entry-content").value = text;
          showToast(`成功导入并填充设定「${file.name}」！`);
        } catch(err) {
          console.error(err);
          showToast("解析设定文件失败: " + err.message);
        }
        fileImport.value = "";
      }
    };
  }
}

// 动态异步加载 JSZip 库，保障 Word 文本解压正常进行
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

// 异步解析 docx 并提取文本，规避由于 binary 格式造成的乱码崩溃
async function parseDocxText(file) {
  await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("无效的 docx Word 格式文件");
  const xmlText = await docXmlFile.async("string");
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const texts = xmlDoc.getElementsByTagName("w:t");
  let out = "";
  for (let i = 0; i < texts.length; i++) {
    out += texts[i].textContent + "\n";
  }
  return out;
}

// 双向在轨自愈型文本读取解码器 (TextDecoder 强校验 UTF-8 与 GBK 降级机制，100% 根除中文乱码)
function readTxtFileSafe(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        const text = utf8Decoder.decode(arrayBuffer);
        resolve(text);
      } catch (err) {
        // 捕获 UTF-8 错码序列异常，回退降级到 GBK 国标编码进行自愈重新翻译
        const gbkDecoder = new TextDecoder("gbk");
        try {
          const text = gbkDecoder.decode(arrayBuffer);
          resolve(text);
        } catch (gbkErr) {
          reject(gbkErr);
        }
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// 循环切换世界书条目的三态模式 (Constant -> Selective -> Disabled)
async function cycleWbMode(id) {
  const entry = await db.world_book_entries.get(id);
  if (!entry) return;

  const currentMode = entry.mode || (entry.isActive ? 'constant' : 'disabled');
  let nextMode = 'constant';
  if (currentMode === 'constant') nextMode = 'selective';
  else if (currentMode === 'selective') nextMode = 'disabled';
  else nextMode = 'constant';

  await db.world_book_entries.update(id, {
    mode: nextMode,
    isActive: nextMode !== 'disabled'
  });
  loadWorldBookData();
}
window.cycleWbMode = cycleWbMode;

// 独立分组遮断器 (仅控制该组别开启/挂起状态，绝对不篡改组内条目的原本三态数据)
function toggleWbGroup(groupName, enable) {
  const storageKey = 'wb_group_disabled_' + groupName;
  if (enable) {
    localStorage.removeItem(storageKey);
  } else {
    localStorage.setItem(storageKey, 'true');
  }
  loadWorldBookData();
}
window.toggleWbGroup = toggleWbGroup;

// 刷新加载列表数据（全新 SVG 矢量三态图标 + 无损分组总开关）
async function loadWorldBookData() {
  const container = document.getElementById("world_book-list-container");
  if (!container) return;
  container.innerHTML = "";

  const list = await db.world_book_entries.toArray();
  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:40px 0;">世界书内暂无任何知识条目，请点击右上角添加。</p>`;
    return;
  }

  // 按照 group 进行折叠划分
  const groups = {};
  list.forEach(entry => {
    const grp = entry.group || "默认分组";
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(entry);
  });

  // 三态纯矢量 SVG 图标集
  const svgConstant = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" style="vertical-align:middle; flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="#3b82f6"/><path d="M8 12l3 3 5-5" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgSelective = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" style="vertical-align:middle; flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="#10b981"/><path d="M7 12h10M13 8l4 4-4 4" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgDisabled = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" style="vertical-align:middle; flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M15 9l-6 6M9 9l6 6" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  for (let key in groups) {
    const wrapper = document.createElement("div");
    wrapper.className = "archive-group-wrapper";

    const isCollapsed = localStorage.getItem(`collapse_wb_${key}`) === 'true';
    const isGroupDisabled = localStorage.getItem(`wb_group_disabled_${key}`) === 'true';

    wrapper.innerHTML = `
      <div class="archive-group-header" data-group="${key}" style="display:flex; justify-content:space-between; align-items:center;">
        <span style="${isGroupDisabled ? 'opacity:0.5;' : ''}">${key} (${groups[key].length}) ${isGroupDisabled ? '<span style="font-size:10px; color:#ef4444; margin-left:4px;">(组别关停)</span>' : ''}</span>
        <div style="display:flex; align-items:center; gap:10px;">
          <label class="switch" title="一键开启/停用整个分组 (不破坏内部条目三态)" onclick="event.stopPropagation()">
            <input type="checkbox" ${!isGroupDisabled ? 'checked' : ''} onchange="toggleWbGroup('${key.replace(/'/g, "\\'")}', this.checked)">
            <span class="slider"></span>
          </label>
          <svg class="group-arrow-icon" viewBox="0 0 24 24" width="16" height="16" style="transform: ${isCollapsed ? 'rotate(-90deg)' : 'none'}; transition: transform 0.2s;"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </div>
      </div>
      <div class="archive-group-content ${isCollapsed ? 'collapsed' : ''}" style="${isGroupDisabled ? 'opacity:0.6;' : ''}"></div>
    `;

    const contentArea = wrapper.querySelector(".archive-group-content");
    groups[key].forEach(entry => {
      const card = document.createElement("div");
      card.className = "archive-card";
      card.style.gap = "10px";

      const mode = entry.mode || (entry.isActive ? 'constant' : 'disabled');
      let modeIcon = svgConstant;
      let modeLabel = "永久";
      if (mode === 'selective') { modeIcon = svgSelective; modeLabel = "关键词"; }
      else if (mode === 'disabled') { modeIcon = svgDisabled; modeLabel = "禁用"; }

      const prob = entry.probability ?? 100;
      const kwText = entry.keywords ? ` | 词: ${entry.keywords}` : "";

      card.innerHTML = `
        <div style="cursor:pointer; display:flex; align-items:center; user-select:none; flex-shrink:0;" onclick="cycleWbMode(${entry.id})" title="轻触切换模式：🔵永久(蓝) 🟢关键词(绿) 🔴禁用(红)">
          ${modeIcon}
        </div>
        <div class="card-info" style="flex:1; overflow:hidden;">
          <div class="card-name" style="font-size:13px; font-weight:700;">
            ${entry.title} 
            <span style="font-size: 10px; color: var(--text-secondary); font-weight:500;">(深度: ${entry.depth} | ${modeLabel} | 概率: ${prob}%${kwText})</span>
          </div>
          <div class="card-desc" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">${entry.content}</div>
        </div>
        <div style="display:flex; align-items:center; gap: 4px; flex-shrink:0;">
          <button class="btn-icon" onclick="editWorldBookItem(${entry.id})">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
          </button>
          <button class="btn-icon" onclick="deleteWorldBookItem(${entry.id})">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;

      contentArea.appendChild(card);
    });

    wrapper.querySelector(".archive-group-header").onclick = (e) => {
      if (e.target.closest(".switch") || e.target.closest("input")) return;
      const collapsed = contentArea.classList.toggle("collapsed");
      localStorage.setItem(`collapse_wb_${key}`, collapsed);
      const icon = e.currentTarget.querySelector(".group-arrow-icon");
      if (icon) icon.style.transform = collapsed ? "rotate(-90deg)" : "none";
    };

    container.appendChild(wrapper);
  }
}

async function openWorldBookForm(editId = null) {
  document.getElementById("wb-entry-id").value = "";
  document.getElementById("wb-entry-group").value = "破限底料";
  document.getElementById("wb-entry-title").value = "";
  document.getElementById("wb-entry-mode").value = "selective";
  document.getElementById("wb-entry-keywords").value = "";
  document.getElementById("wb-entry-prob").value = "100";
  document.getElementById("wb-entry-depth").value = "10";
  document.getElementById("wb-entry-content").value = "";

  document.getElementById("wb-form-title").innerText = editId ? "编辑世界书条目设定" : "添加世界书条目";

  if (editId) {
    const entry = await db.world_book_entries.get(editId);
    if (entry) {
      document.getElementById("wb-entry-id").value = entry.id;
      document.getElementById("wb-entry-group").value = entry.group || "破限底料";
      document.getElementById("wb-entry-title").value = entry.title || "";
      document.getElementById("wb-entry-mode").value = entry.mode || (entry.isActive ? 'constant' : 'disabled');
      document.getElementById("wb-entry-keywords").value = entry.keywords || "";
      document.getElementById("wb-entry-prob").value = entry.probability ?? 100;
      document.getElementById("wb-entry-depth").value = entry.depth ?? 10;
      document.getElementById("wb-entry-content").value = entry.content || "";
    }
  }

  document.getElementById("world_book-form-overlay").classList.add("active");
}

window.editWorldBookItem = function(id) {
  openWorldBookForm(id);
};

window.deleteWorldBookItem = async function(id) {
  if (confirm("确定要删除这一条设定背景吗？")) {
    await db.world_book_entries.delete(id);
    loadWorldBookData();
  }
};