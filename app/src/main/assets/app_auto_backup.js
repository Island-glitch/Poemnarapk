/**
 * app_auto_backup.js - 自动备份中心 (Supabase 云备份 / GitHub 仓库备份 / 每日提醒卡片 / 进度条)
 *
 * 依赖全局函数：serializeRecord / deserializeRecord / performImportTransaction /
 *              loadJSZip / showToast / showCustomConfirm (均来自其他模块，已做存在性兜底)
 */

// === 建表 SQL（用户粘贴到 Supabase SQL Editor 执行即可建立备份表）===
const SUPABASE_BACKUP_SQL = `-- 叙事诗小手机 · 自动备份专用表（支持分片）
CREATE TABLE IF NOT EXISTS app_backups (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  backup_type   TEXT NOT NULL,            -- 'full' 全部数据 / 'text' 纯文字
  batch_id      TEXT,                     -- 分片批次 ID（同一批次的分片共享此 ID）
  chunk_index   INT DEFAULT 0,            -- 分片序号（从 0 开始）
  total_chunks  INT DEFAULT 1,            -- 总分片数
  chunk_data    JSONB                     -- 单片数据（大备份拆分后每片 ≤ 4MB）
);

-- 兼容旧表：若已存在无分片列的旧表，安全追加新列
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_backups' AND column_name='batch_id') THEN
    ALTER TABLE app_backups ADD COLUMN batch_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_backups' AND column_name='chunk_index') THEN
    ALTER TABLE app_backups ADD COLUMN chunk_index INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_backups' AND column_name='total_chunks') THEN
    ALTER TABLE app_backups ADD COLUMN total_chunks INT DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_backups' AND column_name='chunk_data') THEN
    ALTER TABLE app_backups ADD COLUMN chunk_data JSONB;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 开启行级安全
ALTER TABLE app_backups ENABLE ROW LEVEL SECURITY;

-- 彻底清除所有旧策略（遍历删除，避免遗漏）
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN (SELECT policyname FROM pg_policies WHERE tablename = 'app_backups') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app_backups', pol.policyname);
  END LOOP;
END $$;

-- 允许 anon 与 authenticated 角色完整读写（publishable key 对应 anon 角色）
CREATE POLICY "允许管理备份" ON app_backups
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);`;

// GitHub 备份在仓库中的存储目录（分片文件存放于此）
const GITHUB_BACKUP_DIR = "story_phone_backup";
// 旧版单文件路径（向后兼容恢复）
const GITHUB_BACKUP_LEGACY_PATH = "story_phone_backup.json";
// 每片最大字节数（原始 JSON 字符串，base64 编码后约 +33%，留余量确保 < 1MB 读取限制）
const CHUNK_MAX_BYTES = 750000;

let isAutoBackupInitialized = false;

function initAutoBackup() {
  if (isAutoBackupInitialized) return;
  isAutoBackupInitialized = true;

  // 1. 自动备份总开关
  const autoToggle = document.getElementById("auto-backup-enabled-toggle");
  if (autoToggle) {
    autoToggle.checked = localStorage.getItem("auto-backup-enabled") === "true";
    autoToggle.onchange = (e) => {
      localStorage.setItem("auto-backup-enabled", e.target.checked ? "true" : "false");
      showToast(e.target.checked ? "已开启每日自动备份提醒" : "已关闭自动备份提醒");
    };
  }

  // 2. Supabase / GitHub 板块折叠
  bindCollapsible("backup-supabase-toggle", "backup-supabase-body", "backup-supabase-arrow");
  bindCollapsible("backup-github-toggle", "backup-github-body", "backup-github-arrow");

  // 3. 载入已保存的云端配置
  loadCloudBackupConfig();

  // 4. Supabase 事件
  const btnSupaCopy = document.getElementById("btn-supabase-copy-sql");
  if (btnSupaCopy) btnSupaCopy.onclick = copySupabaseSQL;
  const btnSupaAll = document.getElementById("btn-supabase-backup-all");
  if (btnSupaAll) btnSupaAll.onclick = () => supabaseBackup("full");
  const btnSupaText = document.getElementById("btn-supabase-backup-text");
  if (btnSupaText) btnSupaText.onclick = () => supabaseBackup("text");
  const btnSupaRestore = document.getElementById("btn-supabase-restore");
  if (btnSupaRestore) btnSupaRestore.onclick = supabaseRestore;

  // 5. GitHub 事件
  const btnGhTest = document.getElementById("btn-github-test");
  if (btnGhTest) btnGhTest.onclick = githubTestConnection;
  const btnGhAll = document.getElementById("btn-github-backup-all");
  if (btnGhAll) btnGhAll.onclick = () => githubBackup("full");
  const btnGhText = document.getElementById("btn-github-backup-text");
  if (btnGhText) btnGhText.onclick = () => githubBackup("text");
  const btnGhRestore = document.getElementById("btn-github-restore");
  if (btnGhRestore) btnGhRestore.onclick = githubRestore;

  // 6. 配置输入框自动保存
  bindConfigPersist("supabase-backup-url", "supabase-backup-url");
  bindConfigPersist("supabase-backup-key", "supabase-backup-key");
  bindConfigPersist("github-backup-token", "github-backup-token");
  bindConfigPersist("github-backup-user", "github-backup-user");
  bindConfigPersist("github-backup-repo", "github-backup-repo");
}

// 通用折叠面板绑定
function bindCollapsible(toggleId, bodyId, arrowId) {
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (!toggle || !body) return;
  toggle.onclick = () => {
    const collapsed = body.style.display === "none";
    if (collapsed) {
      body.style.display = "block";
      if (arrow) arrow.style.transform = "rotate(0deg)";
    } else {
      body.style.display = "none";
      if (arrow) arrow.style.transform = "rotate(-90deg)";
    }
  };
}

// 输入框配置自动持久化
function bindConfigPersist(inputId, storageKey) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener("change", () => {
    localStorage.setItem(storageKey, input.value);
  });
}

// 载入已保存的云端配置到表单
function loadCloudBackupConfig() {
  const map = {
    "supabase-backup-url": "supabase-backup-url",
    "supabase-backup-key": "supabase-backup-key",
    "github-backup-token": "github-backup-token",
    "github-backup-user": "github-backup-user",
    "github-backup-repo": "github-backup-repo"
  };
  for (let inputId in map) {
    const input = document.getElementById(inputId);
    if (input) input.value = localStorage.getItem(map[inputId]) || "";
  }
}

// === 进度条浮层工具 ===
function showBackupProgress(title) {
  const overlay = document.createElement("div");
  overlay.id = "backup-progress-overlay";
  overlay.style.cssText = `
    position:fixed; top:0; left:0; width:100vw; height:100vh;
    background:rgba(15,23,42,0.45); z-index:20000;
    display:flex; align-items:center; justify-content:center;
    backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
  `;
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:24px 22px; width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.2); text-align:center;">
      <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:14px;">${escapeHtmlBasic(title)}</div>
      <div style="width:100%; height:10px; background:#e2e8f0; border-radius:5px; overflow:hidden;">
        <div id="backup-progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg,#6366f1,#3ecf8e); border-radius:5px; transition:width 0.3s ease;"></div>
      </div>
      <div id="backup-progress-text" style="font-size:11px; color:var(--text-secondary); margin-top:10px; font-weight:600;">准备中...</div>
    </div>`;
  document.body.appendChild(overlay);
  return {
    update(percent, text) {
      const bar = document.getElementById("backup-progress-bar");
      const txt = document.getElementById("backup-progress-text");
      const p = Math.max(0, Math.min(100, percent));
      if (bar) bar.style.width = p + "%";
      if (txt && text) txt.textContent = text;
    },
    close() {
      const el = document.getElementById("backup-progress-overlay");
      if (el) el.remove();
    }
  };
}

function escapeHtmlBasic(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// === 备份数据构建（带进度回调），复用 serializeRecord 序列化 Blob ===
async function buildBackupPayload(textOnly, onProgress) {
  const tables = textOnly
    ? [
        ["archives", db.archives],
        ["relations", db.relations],
        ["sessions", db.sessions],
        ["messages", db.messages],
        ["offline_messages", db.offline_messages],
        ["status_history", db.status_history]
      ]
    : [
        ["api_presets", db.api_presets],
        ["archives", db.archives],
        ["relations", db.relations],
        ["sessions", db.sessions],
        ["messages", db.messages],
        ["world_book_entries", db.world_book_entries],
        ["theaters", db.theaters],
        ["offline_messages", db.offline_messages],
        ["status_history", db.status_history],
        ["sticker_groups", db.sticker_groups],
        ["sticker_items", db.sticker_items],
        ["summaries", db.summaries],
        ["deeptalks", db.deeptalks],
        ["deeptalk_messages", db.deeptalk_messages],
        ["deeptalk_thoughts", db.deeptalk_thoughts],
        ["deeptalk_presets", db.deeptalk_presets],
        ["moments", db.moments],
        ["moment_comments", db.moment_comments],
        ["moment_settings", db.moment_settings],
        ["html_cards", db.html_cards],
        ["desktop_pets", db.desktop_pets],
        ["reader_books", db.reader_books],
        ["reader_chapters", db.reader_chapters],
        ["reader_presets", db.reader_presets],
        ["reader_tags", db.reader_tags],
        ["check_phone_states", db.check_phone_states],
        ["forum_accounts", db.forum_accounts],
        ["forum_posts", db.forum_posts],
        ["forum_comments", db.forum_comments],
        ["forum_likes", db.forum_likes],
        ["forum_forwards", db.forum_forwards],
        ["forum_notifications", db.forum_notifications],
        ["forum_conversations", db.forum_conversations],
        ["forum_messages", db.forum_messages],
        ["forum_follows", db.forum_follows],
        ["forum_presets", db.forum_presets],
        ["forum_npc_accounts", db.forum_npc_accounts],
        ["groups", db.groups],
        ["group_members", db.group_members],
        ["group_polls", db.group_polls]
      ];

  // 补充可选表（部分版本可能不存在）
  if (!textOnly) {
    try { tables.push(["couples_schedules", db.table('couples_schedules')]); } catch(e) {}
    try { tables.push(["couples_albums", db.table('couples_albums')]); } catch(e) {}
    try { tables.push(["couples_journals", db.table('couples_journals')]); } catch(e) {}
    try { tables.push(["couples_whispers", db.table('couples_whispers')]); } catch(e) {}
    if (db.mcp_servers) tables.push(["mcp_servers", db.mcp_servers]);
    if (db.cot_presets) tables.push(["cot_presets", db.cot_presets]);
    if (db.prompt_presets) tables.push(["prompt_presets", db.prompt_presets]);
    if (db.music_playlists) tables.push(["music_playlists", db.music_playlists]);
    if (db.music_songs) tables.push(["music_songs", db.music_songs]);
    if (db.music_logs) tables.push(["music_logs", db.music_logs]);
    if (db.chat_archives) tables.push(["chat_archives", db.chat_archives]);
    if (db.dialogue_vectors) tables.push(["dialogue_vectors", db.dialogue_vectors]);
  }

  const rawBackup = {};
  const total = tables.length;
  for (let i = 0; i < total; i++) {
    const [name, tbl] = tables[i];
    try {
      rawBackup[name] = await tbl.toArray();
    } catch (e) {
      console.warn("读取表失败:", name, e);
      rawBackup[name] = [];
    }
    if (onProgress) onProgress(Math.round(((i + 1) / total) * 60), `读取数据 ${i + 1}/${total}: ${name}`);
  }

  // localStorage 关键配置
  if (textOnly) {
    rawBackup.localStorage = { active_me_id: localStorage.getItem("active_me_id") };
  } else {
    rawBackup.localStorage = {
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
      dockOpacity: localStorage.getItem("beautify-dock-opacity"),
      desktopScale: localStorage.getItem("beautify-desktop-scale"),
      readerPreferences: localStorage.getItem("reader_preferences"),
      customFontsIndex: localStorage.getItem("custom-fonts-index"),
      customFontsActive: localStorage.getItem("custom-fonts-active")
    };
  }

  if (onProgress) onProgress(75, "序列化二进制资源中...");
  const backup = await serializeRecord(rawBackup);
  if (onProgress) onProgress(85, "数据序列化完成");
  return backup;
}

// === Supabase 备份 ===
function getSupabaseConfig() {
  const url = (document.getElementById("supabase-backup-url").value || "").trim().replace(/\/+$/, "");
  const key = (document.getElementById("supabase-backup-key").value || "").trim();
  return { url, key };
}

function copySupabaseSQL() {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(SUPABASE_BACKUP_SQL).then(() => {
      showToast("建表 SQL 已复制到剪贴板，请粘贴到 Supabase SQL Editor 执行");
    }).catch(() => fallbackCopy(SUPABASE_BACKUP_SQL));
  } else {
    fallbackCopy(SUPABASE_BACKUP_SQL);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showToast("已复制到剪贴板");
  } catch (e) {
    showToast("复制失败，请手动长按选择复制");
  }
  document.body.removeChild(ta);
}

// Supabase 单片最大字节数（JSON 字符串，留余量避免 HTTP body 超限）
const SUPABASE_CHUNK_MAX_BYTES = 4000000;

// 将 JSON 字符串拆分为分片数组
function splitJsonIntoChunks(jsonStr, maxBytes) {
  const bytes = new TextEncoder().encode(jsonStr);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += maxBytes) {
    const slice = bytes.slice(i, i + maxBytes);
    chunks.push(new TextDecoder().decode(slice));
  }
  return chunks;
}

async function supabaseBackup(type) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    showToast("请先填写 Supabase Project URL 和 API Key");
    return;
  }

  const prog = showBackupProgress(type === "full" ? "Supabase 全量备份中" : "Supabase 纯文字备份中");
  try {
    const payload = await buildBackupPayload(type === "text", (p, t) => prog.update(p, t));

    prog.update(85, "正在分片序列化数据...");
    const jsonStr = JSON.stringify(payload);
    const chunks = splitJsonIntoChunks(jsonStr, SUPABASE_CHUNK_MAX_BYTES);
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = chunks.length;

    // 清理旧备份（仅保留最新批次，避免无限堆积）
    prog.update(88, "正在清理旧备份...");
    try {
      await fetch(`${url}/rest/v1/app_backups?batch_id=neq.${batchId}`, {
        method: "DELETE",
        headers: { "apikey": key, "Authorization": `Bearer ${key}` }
      });
    } catch (e) { /* 清理失败不阻断流程 */ }

    // 逐片上传
    for (let i = 0; i < totalChunks; i++) {
      const pct = 88 + Math.round(((i + 1) / totalChunks) * 10);
      prog.update(pct, `正在上传分片 ${i + 1}/${totalChunks}...`);
      const res = await fetch(`${url}/rest/v1/app_backups`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          backup_type: type,
          batch_id: batchId,
          chunk_index: i,
          total_chunks: totalChunks,
          chunk_data: { c: chunks[i] }
        })
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Supabase 返回 ${res.status}: ${errText.slice(0, 200)}`);
      }
    }

    prog.update(100, "备份成功！");
    localStorage.setItem("supabase-backup-url", url);
    localStorage.setItem("supabase-backup-key", key);
    setTimeout(() => { prog.close(); showToast(`Supabase 云端备份成功！（${totalChunks} 片）`); }, 600);
  } catch (err) {
    console.error(err);
    prog.close();
    showToast("Supabase 备份失败: " + err.message);
  }
}

async function supabaseRestore() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    showToast("请先填写 Supabase Project URL 和 API Key");
    return;
  }

  const confirmed = await confirmPromise("恢复数据", "将从 Supabase 拉取最新备份并覆盖本地所有数据，确定继续吗？");
  if (!confirmed) return;

  const prog = showBackupProgress("Supabase 恢复中");
  try {
    // 查询最新批次 ID
    prog.update(15, "正在查询最新备份批次...");
    const metaRes = await fetch(`${url}/rest/v1/app_backups?select=batch_id,chunk_index,total_chunks&order=created_at.desc&limit=1`, {
      headers: { "apikey": key, "Authorization": `Bearer ${key}` }
    });
    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => "");
      throw new Error(`Supabase 返回 ${metaRes.status}: ${errText.slice(0, 200)}`);
    }
    const metaRows = await metaRes.json();
    if (!Array.isArray(metaRows) || metaRows.length === 0) {
      throw new Error("云端暂无任何备份记录");
    }

    const batchId = metaRows[0].batch_id;
    const totalChunks = metaRows[0].total_chunks || 1;

    // 兼容旧版无分片数据（batch_id 为 null，使用 backup_data 字段）
    if (!batchId) {
      prog.update(30, "正在拉取旧版备份数据...");
      const oldRes = await fetch(`${url}/rest/v1/app_backups?order=created_at.desc&limit=1`, {
        headers: { "apikey": key, "Authorization": `Bearer ${key}` }
      });
      if (!oldRes.ok) throw new Error(`Supabase 返回 ${oldRes.status}`);
      const oldRows = await oldRes.json();
      if (!oldRows[0] || !oldRows[0].backup_data) throw new Error("云端备份内容为空");

      prog.update(60, "正在写入本地数据库...");
      await performImportTransaction(oldRows[0].backup_data);
    } else {
      // 分片模式：按 batch_id 拉取所有分片
      prog.update(25, `正在拉取 ${totalChunks} 个分片...`);
      const chunkRes = await fetch(`${url}/rest/v1/app_backups?batch_id=eq.${batchId}&order=chunk_index.asc&select=chunk_data,chunk_index`, {
        headers: { "apikey": key, "Authorization": `Bearer ${key}` }
      });
      if (!chunkRes.ok) throw new Error(`Supabase 返回 ${chunkRes.status}`);

      const chunkRows = await chunkRes.json();
      if (!Array.isArray(chunkRows) || chunkRows.length === 0) {
        throw new Error("云端分片数据为空");
      }

      // 按 chunk_index 排序后拼接
      chunkRows.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
      let jsonStr = "";
      for (let i = 0; i < chunkRows.length; i++) {
        jsonStr += (chunkRows[i].chunk_data && chunkRows[i].chunk_data.c) || "";
        prog.update(25 + Math.round(((i + 1) / chunkRows.length) * 35), `正在拼接分片 ${i + 1}/${chunkRows.length}...`);
      }

      prog.update(60, "正在解析数据...");
      const rawData = JSON.parse(jsonStr);

      prog.update(70, "正在写入本地数据库...");
      await performImportTransaction(rawData);
    }

    prog.update(100, "恢复完成！");
    setTimeout(() => {
      prog.close();
      showToast("Supabase 数据恢复成功！即将重载...");
      setTimeout(() => location.reload(), 800);
    }, 600);
  } catch (err) {
    console.error(err);
    prog.close();
    showToast("Supabase 恢复失败: " + err.message);
  }
}

// === GitHub 备份 ===
function getGitHubConfig() {
  const token = (document.getElementById("github-backup-token").value || "").trim();
  const user = (document.getElementById("github-backup-user").value || "").trim();
  const repo = (document.getElementById("github-backup-repo").value || "").trim();
  return { token, user, repo };
}

function githubHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubTestConnection() {
  const { token, user, repo } = getGitHubConfig();
  if (!token || !user || !repo) {
    showToast("请填写完整的 Token、用户名和仓库名");
    return;
  }
  showToast("正在测试 GitHub 连接...");
  try {
    const res = await fetch(`https://api.github.com/repos/${user}/${repo}`, { headers: githubHeaders(token) });
    if (res.status === 200) {
      const data = await res.json();
      showToast(`连接成功！仓库「${data.full_name}」可访问`);
      localStorage.setItem("github-backup-token", token);
      localStorage.setItem("github-backup-user", user);
      localStorage.setItem("github-backup-repo", repo);
    } else if (res.status === 404) {
      showToast("连接失败：仓库不存在或 Token 无 repo 权限");
    } else if (res.status === 401) {
      showToast("连接失败：Token 无效或已过期");
    } else {
      showToast(`连接失败：HTTP ${res.status}`);
    }
  } catch (err) {
    showToast("测试连接异常: " + err.message);
  }
}

// JSON 字符串 → UTF-8 Base64
function strToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToStr(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// 获取仓库中某文件的 sha（用于覆盖更新）
async function githubGetFileSha(token, user, repo, path) {
  try {
    const res = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${path}`, { headers: githubHeaders(token) });
    if (res.status === 200) {
      const data = await res.json();
      return data.sha || null;
    }
  } catch (e) {}
  return null;
}

// 删除仓库中某文件（清理旧分片）
async function githubDeleteFile(token, user, repo, path, sha) {
  try {
    await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${path}`, {
      method: "DELETE",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message: `cleanup ${path}`, sha: sha })
    });
  } catch (e) {}
}

// 获取仓库指定目录下的文件列表
async function githubListDir(token, user, repo, dir) {
  try {
    const res = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${dir}`, { headers: githubHeaders(token) });
    if (res.status === 200) return await res.json();
  } catch (e) {}
  return [];
}

async function githubBackup(type) {
  const { token, user, repo } = getGitHubConfig();
  if (!token || !user || !repo) {
    showToast("请填写完整的 Token、用户名和仓库名");
    return;
  }

  const prog = showBackupProgress(type === "full" ? "GitHub 全量备份中" : "GitHub 纯文字备份中");
  try {
    const payload = await buildBackupPayload(type === "text", (p, t) => prog.update(p, t));

    prog.update(82, "正在分片并编码数据...");
    const jsonStr = JSON.stringify(payload);
    const chunks = splitJsonIntoChunks(jsonStr, CHUNK_MAX_BYTES);
    const totalChunks = chunks.length;

    // 清理旧分片文件（列出目录后逐个删除）
    prog.update(85, "正在清理旧备份分片...");
    const oldFiles = await githubListDir(token, user, repo, GITHUB_BACKUP_DIR);
    for (const f of oldFiles) {
      if (f.path && f.sha) await githubDeleteFile(token, user, repo, f.path, f.sha);
    }
    // 同时清理旧版单文件
    const legacySha = await githubGetFileSha(token, user, repo, GITHUB_BACKUP_LEGACY_PATH);
    if (legacySha) await githubDeleteFile(token, user, repo, GITHUB_BACKUP_LEGACY_PATH, legacySha);

    // 逐片上传
    for (let i = 0; i < totalChunks; i++) {
      const pct = 85 + Math.round(((i + 1) / totalChunks) * 13);
      prog.update(pct, `正在上传分片 ${i + 1}/${totalChunks}...`);
      const chunkPath = `${GITHUB_BACKUP_DIR}/chunk_${String(i).padStart(3, "0")}.b64`;
      const body = {
        message: `backup chunk ${i + 1}/${totalChunks} ${new Date().toLocaleString()}`,
        content: strToBase64(chunks[i])
      };
      const res = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${chunkPath}`, {
        method: "PUT",
        headers: { ...githubHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`GitHub 返回 ${res.status}: ${(errData.message || "").slice(0, 200)}`);
      }
    }

    // 上传 manifest 清单文件（记录分片数与时间戳）
    prog.update(99, "正在写入清单文件...");
    const manifest = JSON.stringify({ totalChunks, type, timestamp: Date.now(), version: 2 });
    const manifestBody = {
      message: `backup manifest ${new Date().toLocaleString()}`,
      content: strToBase64(manifest)
    };
    const manifestSha = await githubGetFileSha(token, user, repo, `${GITHUB_BACKUP_DIR}/manifest.json`);
    if (manifestSha) manifestBody.sha = manifestSha;
    await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${GITHUB_BACKUP_DIR}/manifest.json`, {
      method: "PUT",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(manifestBody)
    });

    prog.update(100, "备份成功！");
    localStorage.setItem("github-backup-token", token);
    localStorage.setItem("github-backup-user", user);
    localStorage.setItem("github-backup-repo", repo);
    setTimeout(() => { prog.close(); showToast(`GitHub 仓库备份成功！（${totalChunks} 片）`); }, 600);
  } catch (err) {
    console.error(err);
    prog.close();
    showToast("GitHub 备份失败: " + err.message);
  }
}

async function githubRestore() {
  const { token, user, repo } = getGitHubConfig();
  if (!token || !user || !repo) {
    showToast("请填写完整的 Token、用户名和仓库名");
    return;
  }

  const confirmed = await confirmPromise("恢复数据", "将从 GitHub 仓库拉取备份并覆盖本地所有数据，确定继续吗？");
  if (!confirmed) return;

  const prog = showBackupProgress("GitHub 恢复中");
  try {
    // 1. 尝试读取分片 manifest
    prog.update(10, "正在读取备份清单...");
    const manifestRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${GITHUB_BACKUP_DIR}/manifest.json`, { headers: githubHeaders(token) });

    if (manifestRes.status === 200) {
      // ===== 分片模式 =====
      const manifestFile = await manifestRes.json();
      let manifest;
      if (manifestFile.content) {
        manifest = JSON.parse(base64ToStr(manifestFile.content.replace(/\n/g, "")));
      } else if (manifestFile.download_url) {
        // 文件 > 1MB 时 content 为空，通过 download_url 拉取原始内容
        const rawRes = await fetch(manifestFile.download_url);
        manifest = JSON.parse(await rawRes.text());
      } else {
        throw new Error("无法读取备份清单");
      }

      const totalChunks = manifest.totalChunks || 1;
      let jsonStr = "";

      for (let i = 0; i < totalChunks; i++) {
        const pct = 15 + Math.round(((i + 1) / totalChunks) * 50);
        prog.update(pct, `正在拉取分片 ${i + 1}/${totalChunks}...`);
        const chunkPath = `${GITHUB_BACKUP_DIR}/chunk_${String(i).padStart(3, "0")}.b64`;
        const chunkRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${chunkPath}`, { headers: githubHeaders(token) });

        if (!chunkRes.ok) throw new Error(`分片 ${i + 1} 拉取失败: HTTP ${chunkRes.status}`);

        const chunkFile = await chunkRes.json();
        let chunkB64 = "";
        if (chunkFile.content) {
          chunkB64 = chunkFile.content.replace(/\n/g, "");
        } else if (chunkFile.download_url) {
          // 分片 > 1MB 时通过 download_url 拉取
          const rawRes = await fetch(chunkFile.download_url);
          chunkB64 = await rawRes.text();
        } else {
          throw new Error(`分片 ${i + 1} 内容为空`);
        }
        jsonStr += base64ToStr(chunkB64);
      }

      prog.update(70, "正在解析数据...");
      const rawData = JSON.parse(jsonStr);

      prog.update(80, "正在写入本地数据库...");
      await performImportTransaction(rawData);
    } else {
      // ===== 向后兼容：旧版单文件模式 =====
      prog.update(20, "未找到分片清单，尝试旧版单文件恢复...");
      const res = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${GITHUB_BACKUP_LEGACY_PATH}`, { headers: githubHeaders(token) });

      if (res.status === 404) {
        throw new Error("仓库中暂无备份文件");
      }
      if (!res.ok) {
        throw new Error(`GitHub 返回 ${res.status}`);
      }

      const fileData = await res.json();
      let jsonStr = "";

      if (fileData.content) {
        // 小文件：直接从 content 字段解码
        jsonStr = base64ToStr(fileData.content.replace(/\n/g, ""));
      } else if (fileData.download_url) {
        // 大文件（>1MB）：通过 download_url 拉取原始 base64 内容
        prog.update(40, "正在通过下载链接拉取大文件...");
        const rawRes = await fetch(fileData.download_url);
        const rawText = await rawRes.text();
        // download_url 返回的是原始文件内容（即 base64 编码的字符串）
        jsonStr = base64ToStr(rawText.trim());
      } else {
        throw new Error("备份文件内容为空");
      }

      prog.update(65, "正在解析数据...");
      const rawData = JSON.parse(jsonStr);

      prog.update(80, "正在写入本地数据库...");
      await performImportTransaction(rawData);
    }

    prog.update(100, "恢复完成！");
    setTimeout(() => {
      prog.close();
      showToast("GitHub 数据恢复成功！即将重载...");
      setTimeout(() => location.reload(), 800);
    }, 600);
  } catch (err) {
    console.error(err);
    prog.close();
    showToast("GitHub 恢复失败: " + err.message);
  }
}

// === Promise 化的确认弹窗（兼容 showCustomConfirm）===
function confirmPromise(title, message) {
  return new Promise((resolve) => {
    if (typeof window.showCustomConfirm === "function") {
      window.showCustomConfirm(title, message, () => resolve(true), () => resolve(false));
    } else {
      resolve(confirm(message));
    }
  });
}

// === 每日首次打开主界面提醒卡片 ===
function maybeShowDailyBackupPrompt() {
  if (localStorage.getItem("auto-backup-enabled") !== "true") return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (localStorage.getItem("auto-backup-last-prompt-date") === today) return;

  // 标记今日已提示，避免重复弹出
  localStorage.setItem("auto-backup-last-prompt-date", today);

  // 延迟弹出，等待主界面渲染完成
  setTimeout(() => showDailyBackupCard(), 1500);
}

function showDailyBackupCard() {
  // 移除已存在的卡片
  const old = document.getElementById("daily-backup-card-overlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "daily-backup-card-overlay";
  overlay.style.cssText = `
    position:fixed; top:0; left:0; width:100vw; height:100vh;
    background:rgba(15,23,42,0.4); z-index:19000;
    display:flex; align-items:center; justify-content:center;
    backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
    opacity:0; transition:opacity 0.25s ease;
  `;
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:18px; padding:24px 22px; width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.2); text-align:center;">
      <div style="width:56px; height:56px; margin:0 auto 12px; border-radius:50%; background:linear-gradient(135deg,#eef2ff,#f0fdf4); display:flex; align-items:center; justify-content:center;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
      </div>
      <div style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:6px;">今日备份提醒</div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:18px;">保护您的珍贵数据，建议每天备份一次。请选择备份方式：</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="daily-backup-btn" data-target="local" style="height:40px; border:none; border-radius:10px; background:#1e88e5; color:#fff; font-size:13px; font-weight:700; cursor:pointer;">备份到本地</button>
        <button class="daily-backup-btn" data-target="supabase" style="height:40px; border:none; border-radius:10px; background:#3ecf8e; color:#fff; font-size:13px; font-weight:700; cursor:pointer;">Supabase 备份</button>
        <button class="daily-backup-btn" data-target="github" style="height:40px; border:none; border-radius:10px; background:#24292e; color:#fff; font-size:13px; font-weight:700; cursor:pointer;">GitHub 备份</button>
        <button class="daily-backup-skip" style="height:36px; border:none; border-radius:10px; background:transparent; color:var(--text-secondary); font-size:12px; font-weight:600; cursor:pointer; margin-top:4px;">暂不备份</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.style.opacity = "1");

  const close = () => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 250);
  };

  overlay.querySelector(".daily-backup-skip").onclick = close;

  overlay.querySelectorAll(".daily-backup-btn").forEach(btn => {
    btn.onclick = async () => {
      const target = btn.getAttribute("data-target");
      close();
      if (target === "local") {
        if (typeof exportBackup === "function") {
          await exportBackup();
        } else {
          showToast("本地备份功能加载中");
        }
      } else if (target === "supabase") {
        const { url, key } = getSupabaseConfig();
        if (!url || !key) {
          showToast("请先在 设置→数据管理→Supabase 自动备份 中填写配置");
          return;
        }
        await supabaseBackup("full");
      } else if (target === "github") {
        const { token, user, repo } = getGitHubConfig();
        if (!token || !user || !repo) {
          showToast("请先在 设置→数据管理→GitHub 自动备份 中填写配置");
          return;
        }
        await githubBackup("full");
      }
    };
  });
}

// 暴露给全局调用（主界面加载完成后触发）
window.maybeShowDailyBackupPrompt = maybeShowDailyBackupPrompt;

// === 初始化挂载 ===
document.addEventListener("DOMContentLoaded", () => {
  initAutoBackup();
  // 主界面加载完成后直接触发每日备份提醒
  setTimeout(() => maybeShowDailyBackupPrompt(), 800);
});
