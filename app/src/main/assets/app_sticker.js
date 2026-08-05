/**
 * app_sticker.js - 表情包管理功能模块
 */

// ============================================================
//  全局变量与基础挂载
// ============================================================
let stickerGroups = [];            // 所有分组列表
let stickerItems = {};             // key: groupId, value: items[]
let selectedStickerGroupId = null; // 管理面板当前选中的分组
let currentEditItem = null;        // 正在编辑的表情包条目
let stickerInitDone = false;       // 是否已完成初始化

// ============================================================
//  自研 WeChat-Style Toast 提示服务 (防止调用ReferenceError)
// ============================================================
function showToast(message) {
  let toast = document.getElementById('app-sticker-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-sticker-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(15, 23, 42, 0.9);
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      z-index: 11000;
      opacity: 0;
      pointer-events: none;
      transition: transform 0.25s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.2s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2300);
}

// ============================================================
//  全局 API Key 一键复制函数（单机本地，无泄露风险）
// ============================================================
function copyApiKey(inputId) {
  try {
    const el = document.getElementById(inputId);
    if (!el) { showToast('未找到输入框'); return; }
    const val = (el.value || '').trim();
    if (!val) { showToast('输入框为空'); return; }
    // 优先用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(() => {
        showToast('已复制到剪贴板');
      }).catch(() => {
        fallbackCopy(el, val);
      });
    } else {
      fallbackCopy(el, val);
    }
  } catch (e) {
    showToast('复制失败');
  }
}

// 降级复制方案（HTTP 或老浏览器）
function fallbackCopy(el, val) {
  try {
    el.removeAttribute('type');
    el.type = 'text';
    el.select();
    const ok = document.execCommand('copy');
    el.type = 'password';
    if (ok) showToast('已复制到剪贴板');
    else showToast('复制失败，请手动复制');
  } catch (e) {
    showToast('复制失败，请手动复制');
  }
}

// ============================================================
//  初始化：读取所有分组和条目并保障首次加载激活
// ============================================================
async function initStickerSystem() {
  try {
    stickerGroups = await db.sticker_groups.orderBy('sortOrder').toArray();
    // 加载每个分组下的条目
    stickerItems = {};
    for (const g of stickerGroups) {
      const items = await db.sticker_items
        .where('groupId').equals(g.id)
        .sortBy('sortOrder');
      stickerItems[g.id] = items;
    }
    stickerInitDone = true;

    // 核心修复：自动选择首个有效的分组进行激活和渲染，杜绝首次进管理白屏且点击无响应的死锁
    if (stickerGroups.length > 0) {
      if (!selectedStickerGroupId || !stickerGroups.some(g => g.id === selectedStickerGroupId)) {
        selectedStickerGroupId = stickerGroups[0].id;
      }
    } else {
      selectedStickerGroupId = null;
    }

    renderStickerGroupTabs();
    renderStickerManagerGrid();
  } catch (e) {
    console.error('[Sticker] 初始化失败:', e);
    showToast('载入表情包数据失败');
  }
}

// ============================================================
//  工具函数
// ============================================================
async function saveStickerGroups() {
  for (let i = 0; i < stickerGroups.length; i++) {
    await db.sticker_groups.put({ ...stickerGroups[i], sortOrder: i });
  }
}

async function saveStickerItems(groupId) {
  const items = stickerItems[groupId] || [];
  for (let i = 0; i < items.length; i++) {
    await db.sticker_items.put({ ...items[i], sortOrder: i });
  }
}

// ============================================================
//  管理面板：渲染分组标签栏
// ============================================================
function renderStickerGroupTabs() {
  const container = document.getElementById('sticker-group-tabs');
  if (!container) return;
  
  let html = '';
  for (const g of stickerGroups) {
    const active = g.id === selectedStickerGroupId ? 'active' : '';
    const count = (stickerItems[g.id] || []).length;
    html += `<div class="sticker-group-tab ${active}" data-group-id="${g.id}">
      ${escapeHtml(g.name)} <span style="opacity:0.6;font-size:10px">(${count})</span>
    </div>`;
  }
  container.innerHTML = html;
  
  // 绑定点击事件，打通标签和内容联动
  container.querySelectorAll('.sticker-group-tab').forEach(el => {
    el.addEventListener('click', () => {
      selectedStickerGroupId = parseInt(el.dataset.groupId);
      renderStickerGroupTabs();
      renderStickerManagerGrid();
    });
  });
}

// ============================================================
//  管理面板：渲染表情包网格 (去 Emoji 改用纯 SVG path 图标)
// ============================================================
function renderStickerManagerGrid() {
  const container = document.getElementById('sticker-manager-grid');
  if (!container) return;
  
  const groupId = selectedStickerGroupId;
  const items = groupId ? (stickerItems[groupId] || []) : [];
  
  if (!groupId) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-secondary);grid-column: span 3;">
        <svg width="48" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 12px; color: var(--text-secondary); display:block; opacity: 0.8;">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">暂无表情包分组</div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 16px; opacity: 0.85;">新建一个专属分组来分类整理您的表情包</div>
        <button class="btn btn-primary" onclick="stickerSystem.showAddGroupDialog()" style="padding: 8px 16px; font-size:12px; margin: 0 auto; display:block; border-radius: 12px;">+ 新建分组</button>
      </div>
    `;
    return;
  }
  
  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-secondary);grid-column: span 3;">
        <svg width="48" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 12px; color: var(--text-secondary); display:block; opacity: 0.8;">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">当前分组暂无表情</div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 16px; opacity: 0.85;">上传一张图片或通过 URL 批量解析导入到此分组</div>
        <button class="btn btn-primary" onclick="stickerSystem.showStickerAddModal()" style="padding: 8px 16px; font-size:12px; margin: 0 auto; display:block; border-radius: 12px;">+ 添加表情包</button>
      </div>
    `;
    return;
  }
  
  let html = '';
  for (const item of items) {
    html += `<div class="sticker-manager-card" data-item-id="${item.id}">
      <div class="sticker-preview">
        <img src="${item.imageUrl}" alt="${escapeHtml(item.caption)}" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="sticker-caption">${escapeHtml(item.caption)}</div>
    </div>`;
  }
  container.innerHTML = html;
  
  // 绑定点击事件：编辑/删除
  container.querySelectorAll('.sticker-manager-card').forEach(el => {
    el.addEventListener('click', () => {
      const itemId = parseInt(el.dataset.itemId);
      const groupId = selectedStickerGroupId;
      const items = stickerItems[groupId] || [];
      const item = items.find(i => i.id === itemId);
      if (item) {
        showStickerEditModal(item);
      }
    });
  });
}

// ============================================================
//  管理面板：添加分组
// ============================================================
function showAddGroupDialog() {
  const name = prompt('请输入新分组的名称：');
  if (!name || !name.trim()) return;
  addStickerGroup(name.trim());
}

async function addStickerGroup(name) {
  const maxOrder = stickerGroups.reduce((max, g) => Math.max(max, g.sortOrder || 0), 0);
  const newGroup = { name, sortOrder: maxOrder + 1 };
  const id = await db.sticker_groups.add(newGroup);
  newGroup.id = id;
  stickerGroups.push(newGroup);
  stickerItems[id] = [];
  selectedStickerGroupId = id;
  renderStickerGroupTabs();
  renderStickerManagerGrid();
  showToast('分组新建成功');
}

// ============================================================
//  管理面板：重rename/删除分组
// ============================================================
async function renameStickerGroup() {
  if (!selectedStickerGroupId) {
    showToast('请先选择一个分组');
    return;
  }
  const group = stickerGroups.find(g => g.id === selectedStickerGroupId);
  if (!group) return;
  const name = prompt('请输入新的分组名称：', group.name);
  if (!name || !name.trim()) return;
  group.name = name.trim();
  await db.sticker_groups.put(group);
  renderStickerGroupTabs();
  showToast('分组已重命名');
}

async function deleteStickerGroup() {
  if (!selectedStickerGroupId) {
    showToast('请先选择一个分组');
    return;
  }
  const group = stickerGroups.find(g => g.id === selectedStickerGroupId);
  if (!group) return;
  const items = stickerItems[selectedStickerGroupId] || [];
  const confirmMsg = `确定要删除分组「${group.name}」吗？\n该分组下有 ${items.length} 个表情包，将一并删除。`;
  if (!confirm(confirmMsg)) return;
  
  await db.sticker_groups.delete(selectedStickerGroupId);
  const itemIds = items.map(i => i.id);
  if (itemIds.length > 0) {
    await db.sticker_items.bulkDelete(itemIds);
  }
  
  stickerGroups = stickerGroups.filter(g => g.id !== selectedStickerGroupId);
  delete stickerItems[selectedStickerGroupId];
  selectedStickerGroupId = stickerGroups.length > 0 ? stickerGroups[0].id : null;
  
  renderStickerGroupTabs();
  renderStickerManagerGrid();
  showToast('分组已删除');
}

// ============================================================
//  添加表情包：显示添加浮层
// ============================================================
function showStickerAddModal() {
  if (!selectedStickerGroupId) {
    showToast('请先选择一个分组');
    return;
  }
  
  const overlay = document.getElementById('sticker-add-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  switchStickerAddMethod('upload');
}

function switchStickerAddMethod(method) {
  const uploadArea = document.getElementById('sticker-upload-area');
  const batchArea = document.getElementById('sticker-batch-area');
  const uploadTab = document.getElementById('sticker-method-upload');
  const batchTab = document.getElementById('sticker-method-batch');
  
  if (uploadArea) uploadArea.style.display = method === 'upload' ? 'block' : 'none';
  if (batchArea) batchArea.style.display = method === 'batch' ? 'block' : 'none';
  if (uploadTab) uploadTab.classList.toggle('active', method === 'upload');
  if (batchTab) batchTab.classList.toggle('active', method === 'batch');
}

// ============================================================
//  添加表情包：方法1 - 单张图片上传
// ============================================================
function handleStickerUpload() {
  const fileInput = document.getElementById('sticker-file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('请先选择一张图片');
    return;
  }
  
  const file = fileInput.files[0];
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const imageUrl = e.target.result;
    const preview = document.getElementById('sticker-upload-preview');
    if (preview) {
      preview.innerHTML = `<img src="${imageUrl}" style="max-width:100%;max-height:120px;border-radius:8px;display:block;margin:10px auto;border:1px solid var(--border);">`;
    }
    
    const caption = prompt('请输入此表情包的释义（用于 AI 理解，如：乖巧、流泪）：');
    if (!caption || !caption.trim()) {
      showToast('已取消添加');
      return;
    }
    
    await addStickerItem(selectedStickerGroupId, imageUrl, caption.trim());
    
    fileInput.value = '';
    if (preview) preview.innerHTML = '';
    document.getElementById('sticker-add-overlay')?.classList.remove('active');
    showToast('表情导入成功');
  };
  reader.readAsDataURL(file);
}

// ============================================================
//  添加表情包：方法2 - URL批量上传
// ============================================================
async function handleStickerBatchUpload() {
  const textarea = document.getElementById('sticker-batch-text');
  if (!textarea || !textarea.value.trim()) {
    showToast('请输入符合规则的表情包数据');
    return;
  }
  
  const lines = textarea.value.trim().split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) {
    showToast('未解析到有效行');
    return;
  }
  
  let successCount = 0;
  let failCount = 0;
  
  for (const line of lines) {
    const match = line.match(/^(.+?)[：:]\s*(https?:\/\/\S+|data:image\/\S+)$/i);
    if (!match) {
      failCount++;
      continue;
    }
    const caption = match[1].trim();
    const url = match[2].trim();
    if (!caption || !url) {
      failCount++;
      continue;
    }
    
    try {
      await addStickerItem(selectedStickerGroupId, url, caption);
      successCount++;
    } catch (e) {
      failCount++;
    }
  }
  
  textarea.value = '';
  document.getElementById('sticker-add-overlay')?.classList.remove('active');
  showToast(`批量添加完成：成功 ${successCount} 个，失败 ${failCount} 个`);
}

// ============================================================
//  添加单个表情包条目（通用）
// ============================================================
async function addStickerItem(groupId, imageUrl, caption) {
  if (!groupId || !imageUrl || !caption) return;
  
  const items = stickerItems[groupId] || [];
  const maxOrder = items.reduce((max, i) => Math.max(max, i.sortOrder || 0), 0);
  
  const newItem = {
    groupId,
    sortOrder: maxOrder + 1,
    imageUrl,
    caption
  };
  
  const id = await db.sticker_items.add(newItem);
  newItem.id = id;
  items.push(newItem);
  stickerItems[groupId] = items;
  
  renderStickerGroupTabs();
  renderStickerManagerGrid();
}

// ============================================================
//  编辑/删除表情包浮层
// ============================================================
function showStickerEditModal(item) {
  currentEditItem = item;
  const overlay = document.getElementById('sticker-edit-overlay');
  if (!overlay) return;
  
  const img = overlay.querySelector('.sticker-edit-image');
  const captionInput = overlay.querySelector('.sticker-edit-caption');
  
  if (img) img.src = item.imageUrl;
  if (captionInput) captionInput.value = item.caption;
  
  overlay.classList.add('active');
}

async function saveStickerEdit() {
  if (!currentEditItem) return;
  
  const overlay = document.getElementById('sticker-edit-overlay');
  const captionInput = overlay?.querySelector('.sticker-edit-caption');
  if (!captionInput) return;
  
  const newCaption = captionInput.value.trim();
  if (!newCaption) {
    showToast('释义不能为空');
    return;
  }
  
  currentEditItem.caption = newCaption;
  await db.sticker_items.put(currentEditItem);
  
  const groupItems = stickerItems[currentEditItem.groupId] || [];
  const idx = groupItems.findIndex(i => i.id === currentEditItem.id);
  if (idx !== -1) groupItems[idx] = currentEditItem;
  
  if (overlay) overlay.classList.remove('active');
  currentEditItem = null;
  
  renderStickerManagerGrid();
  showToast('表情释义修改成功');
}

async function deleteStickerEdit() {
  if (!currentEditItem) return;
  if (!confirm(`确定要彻底删除表情「${currentEditItem.caption}」吗？`)) return;
  
  await db.sticker_items.delete(currentEditItem.id);
  
  const groupItems = stickerItems[currentEditItem.groupId] || [];
  stickerItems[currentEditItem.groupId] = groupItems.filter(i => i.id !== currentEditItem.id);
  
  const overlay = document.getElementById('sticker-edit-overlay');
  if (overlay) overlay.classList.remove('active');
  currentEditItem = null;
  
  renderStickerManagerGrid();
  renderStickerGroupTabs();
  showToast('表情已成功删除');
}

// ============================================================
//  对话中的表情包选择栏与挂载 (修复 ID 类型并校准主键)
// ============================================================
async function getMountedGroupIds(sessionId) {
  try {
    const numSessionId = Number(sessionId);
    const session = await db.sessions.get(numSessionId);
    if (!session) return [];

    // 核心自愈：如果是群聊，自适应从 groups 主表读取挂载表情包，保障挂载逻辑就地生效
    if (session.isGroup === 1) {
      const group = await db.groups.get(session.groupId);
      if (!group || !group.stickerMountedGroupIds) return [];
      return group.stickerMountedGroupIds.split(',').map(s => parseInt(s.trim())).filter(id => !isNaN(id));
    }

    if (!session.stickerMountedGroupIds) return [];
    return session.stickerMountedGroupIds.split(',').map(s => parseInt(s.trim())).filter(id => !isNaN(id));
  } catch (e) {
    return [];
  }
}

// 唤出表情包面板，同步开启全屏点击拦截保护层
async function openStickerSelector(sessionId) {
  if (!stickerInitDone) await initStickerSystem();
  
  const mountedIds = await getMountedGroupIds(sessionId);
  if (mountedIds.length === 0) {
    showToast('当前对话未挂载表情分组，请先在详情设置中挂载');
    return;
  }
  
  const overlay = document.getElementById('sticker-select-overlay');
  if (!overlay) return;
  
  const body = overlay.querySelector('.sticker-select-body');
  if (!body) return;
  
  let html = '';
  for (const groupId of mountedIds) {
    const group = stickerGroups.find(g => g.id === groupId);
    if (!group) continue;
    const items = stickerItems[groupId] || [];
    if (items.length === 0) continue;
    
    html += `<div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;padding:6px 8px;color:#ec4899;border-bottom:1.5px solid #fbcfe8;margin-bottom:8px;">${escapeHtml(group.name)}</div>
      <div class="sticker-select-grid">`;
    
    for (const item of items) {
      html += `<div class="sticker-select-item" data-image-url="${escapeHtml(item.imageUrl)}" data-caption="${escapeHtml(item.caption)}" data-item-id="${item.id}">
        <img src="${item.imageUrl}" alt="${escapeHtml(item.caption)}" loading="lazy" onerror="this.style.display='none'">
        <div class="sticker-sel-caption">${escapeHtml(item.caption)}</div>
      </div>`;
    }
    
    html += `</div></div>`;
  }
  
  if (!html) {
    body.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-secondary);font-size:13px">挂载的分组中暂无表情包条目</div>';
  } else {
    body.innerHTML = html;
  }
  
  // 核心修复：同步激活全屏点击拦截罩，阻断下层多余点击，点击该遮罩直接关闭表情栏
  const backdrop = document.getElementById('sticker-select-backdrop');
  if (backdrop) {
    backdrop.style.display = 'block';
    backdrop.onclick = () => closeStickerSelector();
  }

  overlay.classList.add('active');
  
  // 绑定选择表情注入到输入框中的微信转译语法
  body.querySelectorAll('.sticker-select-item').forEach(el => {
    el.addEventListener('click', () => {
      const caption = el.dataset.caption;
      const stickerText = `【表情包：${caption}】`;
      
      const input = document.getElementById('dialog-input-text');
      if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + stickerText + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + stickerText.length;
        input.focus();
      }
      closeStickerSelector();
    });
  });
}

function closeStickerSelector() {
  const overlay = document.getElementById('sticker-select-overlay');
  if (overlay) overlay.classList.remove('active');

  // 同步关闭防误触背景罩
  const backdrop = document.getElementById('sticker-select-backdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ============================================================
//  挂载设置界面
// ============================================================
async function openStickerMountSettings(sessionId) {
  if (!stickerInitDone) await initStickerSystem();
  
  const mountedIds = await getMountedGroupIds(sessionId);
  
  let html = '<div style="padding:16px">';
  html += '<h4 style="margin:0 0 12px;font-size:15px;text-align:center;font-weight:700;color:var(--text-primary)">选择要挂载的表情包分组</h4>';
  
  if (stickerGroups.length === 0) {
    html += '<p style="text-align:center;color:#94a3b8;font-size:13px">当前没有已添加的表情包分组，请先去我的表情包里创建</p>';
  } else {
    for (const g of stickerGroups) {
      const checked = mountedIds.includes(g.id) ? 'checked' : '';
      const count = (stickerItems[g.id] || []).length;
      html += `<label style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" class="sticker-mount-checkbox" value="${g.id}" ${checked}>
        <span style="flex:1;font-size:14px;color:var(--text-primary);font-weight:600;">${escapeHtml(g.name)}</span>
        <span style="font-size:11px;color:#94a3b8">${count} 个表情包</span>
      </label>`;
    }
  }
  
  html += `<div style="display:flex;gap:12px;margin-top:20px">
    <button onclick="closeStickerMountSettings()" style="flex:1;padding:10px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface);font-size:13px;font-weight:600;cursor:pointer">取消</button>
    <button onclick="saveStickerMountSettings('${sessionId}')" style="flex:1;padding:10px;border-radius:12px;border:none;background:#ec4899;color:#fff;font-size:13px;font-weight:600;cursor:pointer">保存并应用</button>
  </div></div>`;
  
  const existingOverlay = document.getElementById('sticker-mount-overlay');
  if (existingOverlay) {
    existingOverlay.querySelector('.sticker-mount-content').innerHTML = html;
    existingOverlay.classList.add('active');
  }
}

function closeStickerMountSettings() {
  const overlay = document.getElementById('sticker-mount-overlay');
  if (overlay) overlay.classList.remove('active');
}

// 数字类型校准并实现详情设置页面的关联同步刷新
async function saveStickerMountSettings(sessionId) {
  const checkboxes = document.querySelectorAll('.sticker-mount-checkbox:checked');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value)).filter(id => !isNaN(id));
  const numSessionId = Number(sessionId);
  
  const session = await db.sessions.get(numSessionId);
  if (session) {
    await db.sessions.update(numSessionId, {
      stickerMountedGroupIds: ids.join(',')
    });
  }
  
  // 详情设置页面挂载文案联动同步刷新
  const mountedStickersEl = document.getElementById("details-mounted-stickers");
  if (mountedStickersEl) {
    if (ids.length > 0) {
      const names = stickerGroups.filter(g => ids.includes(g.id)).map(g => g.name);
      mountedStickersEl.textContent = names.length > 0 ? names.join('、') : '已挂载 ' + ids.length + ' 个分组';
    } else {
      mountedStickersEl.textContent = '暂无挂载';
    }
  }
  
  closeStickerMountSettings();
  showToast('表情包挂载设置已保存');
}

// ============================================================
//  表情包检测与过滤
// ============================================================
async function processStickersInMessage(text, sessionId) {
  const regex = /【表情包：([^】]+)】/g;
  let match;
  let result = text;
  
  const mountedIds = await getMountedGroupIds(sessionId);
  if (mountedIds.length === 0) {
    return text.replace(regex, '');
  }
  
  const validCaptions = new Set();
  for (const gId of mountedIds) {
    const items = stickerItems[gId] || [];
    for (const item of items) {
      validCaptions.add(item.caption);
    }
  }
  
  while ((match = regex.exec(text)) !== null) {
    const caption = match[1].trim();
    if (!validCaptions.has(caption)) {
      result = result.replace(match[0], '');
      console.warn(`[Sticker] 丢弃未注册的表情包: ${caption}`);
    }
  }
  
  return result;
}

async function getMountedStickerDescriptions(sessionId) {
  const mountedIds = await getMountedGroupIds(sessionId);
  if (mountedIds.length === 0) return null;
  
  const descriptions = [];
  for (const gId of mountedIds) {
    const group = stickerGroups.find(g => g.id === gId);
    if (!group) continue;
    const items = stickerItems[gId] || [];
    for (const item of items) {
      descriptions.push(`- 【表情包：${item.caption}】(${item.caption})`);
    }
  }
  
  if (descriptions.length === 0) return null;
  return descriptions.join('\n');
}

async function buildStickerSystemPrompt(sessionId) {
  const desc = await getMountedStickerDescriptions(sessionId);
  if (!desc) return '';
  
  return `
【表情包系统】
在当前对话中，你可以在回复时使用以下已注册的表情包来表达情感或回应对方：
${desc}

使用方式：在回复文本中直接插入【表情包：释义】格式的标记，例如【表情包：开心】。
注意：
- 只能使用上述列表中已注册的表情包，禁止使用未注册的表情包。
- 表情包应当自然融入对话中，作为情感表达的补充。
- 不要过度使用表情包，每条回复最多使用1-2个。`;
}

// ============================================================
//  消息渲染：将微信语法解析为图片 (极致修复：打通全局在库匹配，防止丢失)
// ============================================================
function renderStickerInMessageSync(text, mountedGroupIds) {
  // 核心修复：不再只从挂载的少数分组搜索，而是直接检索加载进内存的所有在库表情包，彻底解决文字回退 Bug
  const captionMap = {};
  for (const gId in stickerItems) {
    const items = stickerItems[gId] || [];
    for (const item of items) {
      captionMap[item.caption] = item.imageUrl;
    }
  }
  
  if (Object.keys(captionMap).length === 0) {
    return escapeHtml(text);
  }
  
  let result = escapeHtml(text);
  result = result.replace(/【表情包：([^】]+)】/g, (match, caption) => {
    const trimmed = caption.trim();
    const url = captionMap[trimmed];
    if (url) {
      return `<img class="msg-sticker" src="${url}" alt="${escapeHtml(trimmed)}" title="${escapeHtml(trimmed)}">`;
    }
    return match; // 未能正常匹配到的内容进行降级保留展示，不作盲目清空
  });
  
  return result;
}

async function renderStickerInMessage(text, sessionId) {
  const mountedIds = await getMountedGroupIds(sessionId);
  return renderStickerInMessageSync(text, mountedIds);
}

// ============================================================
//  HTML 转义
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

function closeStickerManager() {
  const overlay = document.getElementById('sticker-manager-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ============================================================
//  导出模块
// ============================================================
window.stickerSystem = {
  init: initStickerSystem,
  getMountedGroupIds,
  openStickerSelector,
  closeStickerSelector,
  openStickerMountSettings,
  closeStickerMountSettings,
  processStickersInMessage,
  buildStickerSystemPrompt,
  renderStickerInMessage,
  renderStickerInMessageSync,
  getMountedStickerDescriptions,
  
  // 管理面板接口
  showAddGroupDialog,
  renameStickerGroup,
  deleteStickerGroup,
  showStickerAddModal,
  switchStickerAddMethod,
  handleStickerUpload,
  handleStickerBatchUpload,
  showStickerEditModal,
  saveStickerEdit,
  deleteStickerEdit
};