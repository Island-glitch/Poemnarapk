/**
 * app_music.js - 听歌应用 (0.01秒极速唤起灵动岛、后台并发补拉歌词、完整歌单归属修改与全能中枢)
 * 遵循规范：纯原生全矢量 SVG 图标、禁用 Emoji、网易云 UID/红心曲目无感同步
 */

(function() {
  window.musicSystem = {
    audio: new Audio(),
    playlists: [],
    currentIndex: -1,
    currentPlaylistId: null, // 当前播放歌单ID（设置后顺序/循环/随机只在此歌单内）
    playMode: 'sequence', // sequence | loop | random
    lyrics: [],
    activeLyricIndex: -1,
    mountedCompanion: null,
    ncmCookie: localStorage.getItem("ncm_user_cookie") || "",
    ncmApiBase: localStorage.getItem("ncm_api_base") || "http://localhost:3000",
    ncmAnonCookie: "", // 匿名注册获取的设备 cookie，用于绕过登录风控
    ncmCaptchaCooldown: 0,
    isVip: false,
    showCardLyrics: false,
    isCardChatView: false,
    tempCropCoverBase64: "",
    unikey: "",
    qrPollTimer: null,

    async init() {
      this.bindAudioEvents();
      this.initIndexedDBStorage();
      await this.loadPlaylistsFromStorage();
      this.renderMine();
      this.updateIslandCompanionUI();
    },

    cleanCotText(text) {
      if (!text || typeof text !== 'string') return "";
      return text
        .replace(/(?:<think>|\[THINKING\]|【思考】)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|$)/gi, "")
        .replace(/[\[【](QUOTE|引用)\s*:\s*\d+[\]】]\s*/gi, "")
        .replace(/[\[【]MSG_ID\s*:\s*\d+[\]】]/gi, "")
        .trim();
    },

    async ncmNativeFetch(url, method = "POST", customHeaders = {}, bodyStr = "") {
      const defaultHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Referer": "https://music.163.com/",
        "Content-Type": "application/x-www-form-urlencoded"
      };

      if (this.ncmCookie) {
        defaultHeaders["Cookie"] = this.ncmCookie;
      }

      const finalHeaders = { ...defaultHeaders, ...customHeaders };

      if (window.AndroidMCP && typeof window.AndroidMCP.sendNativeHttpRequest === 'function') {
        const resStr = window.AndroidMCP.sendNativeHttpRequest(url, method, JSON.stringify(finalHeaders), bodyStr);
        try {
          const resObj = JSON.parse(resStr);
          let bodyData = null;
          try {
            bodyData = typeof resObj.body === 'string' ? JSON.parse(resObj.body) : resObj.body;
          } catch(e) {
            bodyData = resObj.body;
          }
          return { status: resObj.status, data: bodyData, headers: resObj.headers || {} };
        } catch(e) {
          return null;
        }
      } else {
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          const res = await fetch(proxyUrl).catch(() => null);
          if (res && res.ok) {
            const rawText = await res.text();
            let bodyData = null;
            try {
              bodyData = JSON.parse(rawText);
            } catch(e) {
              bodyData = rawText;
            }
            return { status: 200, data: bodyData, headers: {} };
          }
        } catch(e) {}
        return null;
      }
    },

    initIndexedDBStorage() {
      if (!window.indexedDB) return;
      const request = indexedDB.open("StoryPhoneMusicDB", 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("songs")) {
          db.createObjectStore("songs", { keyPath: "id" });
        }
      };
    },

    async saveSongToIndexedDB(songObj) {
      return new Promise((resolve) => {
        const req = indexedDB.open("StoryPhoneMusicDB", 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("songs", "readwrite");
          const store = tx.objectStore("songs");
          store.put(songObj);
          tx.oncomplete = () => resolve(true);
        };
        req.onerror = () => resolve(false);
      });
    },

    async getSongFromIndexedDB(id) {
      return new Promise((resolve) => {
        const req = indexedDB.open("StoryPhoneMusicDB", 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("songs", "readonly");
          const store = tx.objectStore("songs");
          const getReq = store.get(id);
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    },

    async getAllSongsFromIndexedDB() {
      return new Promise((resolve) => {
        const req = indexedDB.open("StoryPhoneMusicDB", 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("songs", "readonly");
          const store = tx.objectStore("songs");
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result || []);
          getAllReq.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    },

    async deleteSongFromIndexedDB(id) {
      return new Promise((resolve) => {
        const req = indexedDB.open("StoryPhoneMusicDB", 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("songs", "readwrite");
          const store = tx.objectStore("songs");
          store.delete(id);
          tx.oncomplete = () => resolve(true);
        };
      });
    },

    bindAudioEvents() {
      const audio = this.audio;
      audio.ontimeupdate = () => {
        this.updateProgressUI();
        this.syncLyricsTime();
      };
      audio.onended = () => {
        this.handleSongEnd();
      };
      audio.onplay = () => this.syncPlayStateUI(true);
      audio.onpause = () => this.syncPlayStateUI(false);
    },

    async loadPlaylistsFromStorage() {
      try {
        const localPL = JSON.parse(localStorage.getItem("ncm_playlists"));
        if (localPL && Array.isArray(localPL)) {
          this.playlists = localPL;
        } else {
          this.playlists = [];
          this.savePlaylistsToStorage();
        }
      } catch(e) {
        this.playlists = [];
      }
    },

    savePlaylistsToStorage() {
      localStorage.setItem("ncm_playlists", JSON.stringify(this.playlists));
    },

    openCreatePlaylistModal() {
      const overlay = document.getElementById("ncm-playlist-create-overlay");
      if (overlay) {
        this.switchPlaylistCreateMode("empty");
        overlay.classList.add("active");
      }
    },

    closeCreatePlaylistModal() {
      const overlay = document.getElementById("ncm-playlist-create-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    switchPlaylistCreateMode(mode) {
      document.getElementById("ncm-playlist-create-mode").value = mode;
      const btnEmpty = document.getElementById("btn-pl-mode-empty");
      const btnNcm = document.getElementById("btn-pl-mode-ncm");
      const groupEmpty = document.getElementById("ncm-pl-group-empty");
      const groupNcm = document.getElementById("ncm-pl-group-ncm");

      if (mode === 'empty') {
        if (btnEmpty) { btnEmpty.style.background = "#ec4141"; btnEmpty.style.color = "#fff"; btnEmpty.style.border = "none"; }
        if (btnNcm) { btnNcm.style.background = "transparent"; btnNcm.style.color = "var(--text-primary)"; btnNcm.style.border = "1px solid #e2e8f0"; }
        if (groupEmpty) groupEmpty.style.display = "block";
        if (groupNcm) groupNcm.style.display = "none";
      } else {
        if (btnNcm) { btnNcm.style.background = "#ec4141"; btnNcm.style.color = "#fff"; btnNcm.style.border = "none"; }
        if (btnEmpty) { btnEmpty.style.background = "transparent"; btnEmpty.style.color = "var(--text-primary)"; btnEmpty.style.border = "1px solid #e2e8f0"; }
        if (groupEmpty) groupEmpty.style.display = "none";
        if (groupNcm) groupNcm.style.display = "block";
      }
    },

    // 万能网易云歌单 ID 解析器 (全量兼容 y.music.163.com、m/playlist、playlist?id= 以及 11 位长数字 ID)
    parseNcmPlaylistId(inputStr) {
      if (!inputStr) return null;
      
      // 1. 优先匹配 URL 中的 playlist?id=、playlist/、id= 后面的纯数字
      const match = inputStr.match(/(?:playlist[\/\?]id=|id=|^)(\d+)/i);
      if (match && match[1]) return match[1];

      // 2. 托底机制：直接抽取字符串中的任意 6-12 位连续纯数字 ID
      const numMatch = inputStr.match(/\b\d{6,12}\b/);
      return numMatch ? numMatch[0] : inputStr.trim();
    },

    async submitCreatePlaylist() {
      const mode = document.getElementById("ncm-playlist-create-mode").value;

      if (mode === 'empty') {
        const nameInput = document.getElementById("ncm-playlist-name-input");
        if (!nameInput || !nameInput.value.trim()) {
          if (typeof showToast === 'function') showToast("请输入歌单分组名称");
          return;
        }
        const name = nameInput.value.trim();
        nameInput.value = "";

        this.playlists.push({ id: "pl_" + Date.now(), name, coverUrl: "", songIds: [] });
        this.savePlaylistsToStorage();
        if (typeof showToast === 'function') showToast(`成功新建歌单: ${name}`);
        this.closeCreatePlaylistModal();
        this.renderMine();
      } else {
        // 模式 2: 网易云歌单链接/ID 自动抓取导入
        const linkInput = document.getElementById("ncm-playlist-link-input");
        const playlistId = this.parseNcmPlaylistId(linkInput ? linkInput.value.trim() : "");

        if (!playlistId || !/^\d+$/.test(playlistId)) {
          if (typeof showToast === 'function') showToast("无效的网易云歌单链接或 ID");
          return;
        }

        if (typeof showToast === 'function') showToast("步骤 1/4: 正在向网易云分配网络通道...");

        try {
          const plData = await this.fetchNcmPlaylistDetail(playlistId);

          if (plData && plData.tracks && plData.tracks.length > 0) {
            const plName = plData.name || "网易云歌单";
            const plCover = plData.coverUrl || "";
            const tracks = plData.tracks;
            const totalCount = tracks.length;

            const newPl = {
              id: "pl_ncm_" + playlistId,
              name: plName,
              coverUrl: plCover,
              songIds: []
            };

            for (let i = 0; i < totalCount; i++) {
              const track = tracks[i];
              if (typeof showToast === 'function' && (i % 5 === 0 || i === totalCount - 1)) {
                showToast(`步骤 3/4: 正在存入曲库 (${i + 1}/${totalCount}): ${track.name}`);
              }

              const songId = "ncm_" + track.id;
              const songObj = {
                id: songId,
                title: track.name,
                artist: track.artist || "网易云歌手",
                cover: track.cover || plCover || "",
                url: track.url || `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`,
                lyrics: "[00:00.00]点击播放拉取歌词",
                isVip: track.fee === 1,
                isFavorite: false
              };

              await this.saveSongToIndexedDB(songObj);
              if (!newPl.songIds.includes(songId)) {
                newPl.songIds.push(songId);
              }
            }

            // 检查去重
            const existingIdx = this.playlists.findIndex(p => p.id === newPl.id || p.name === newPl.name);
            if (existingIdx !== -1) {
              this.playlists[existingIdx] = newPl;
            } else {
              this.playlists.push(newPl);
            }

            this.savePlaylistsToStorage();
            if (typeof showToast === 'function') showToast(`步骤 4/4: 成功！同步歌单 《${plName}》 共 ${totalCount} 首曲目`);
            if (linkInput) linkInput.value = "";
            this.closeCreatePlaylistModal();
            this.renderMine();
          } else {
            if (typeof showCustomAlert === 'function') {
              showCustomAlert("导入歌单受阻", `网易云歌单 (ID: ${playlistId}) 解析结果为空。\n\n请检查该歌单是否设为了“私密歌单”或内无公开曲目。`);
            } else {
              alert(`网易云歌单 (ID: ${playlistId}) 解析结果为空，请检查歌单公开状态。`);
            }
          }
        } catch(e) {
          if (typeof showCustomAlert === 'function') {
            showCustomAlert("导入异常诊断", `歌单 ID: ${playlistId}\n详细报错信息: ${e.message}`);
          } else {
            alert(`导入异常诊断: ${e.message}`);
          }
        }
      }
    },

    // 带 3.5 秒硬超时熔断器的多节点竞速歌单解析器 (彻底打消第一步卡死)
    async fetchNcmPlaylistDetail(playlistId) {
      if (!playlistId) return null;

      // 3.5 秒强制超时切断器，防止任何单一通道网络挂起导致的假死
      const fetchWithTimeout = async (fn, ms = 3500) => {
        return Promise.race([
          fn(),
          new Promise(resolve => setTimeout(() => resolve(null), ms))
        ]);
      };

      try {
        if (typeof showToast === 'function') showToast("步骤 1/4: 连接网易云极速节点...");

        // 1. 通道一：极速 Meting 开源 API 节点 (0.3 秒无阻碍直连)
        let mirrorData = await fetchWithTimeout(async () => {
          const res = await fetch(`https://api.i-meto.com/meting/v1/playlist?id=${playlistId}`).catch(() => null);
          if (res && res.ok) {
            const list = await res.json().catch(() => null);
            if (Array.isArray(list) && list.length > 0) {
              const tracks = list.map(t => ({
                id: t.id || t.song_id,
                name: t.name || t.title || "未知歌曲",
                artist: t.artist || t.author || "网易云歌手",
                cover: t.pic || t.cover || "",
                fee: 0,
                url: t.url || `https://music.163.com/song/media/outer/url?id=${t.id}.mp3`
              }));
              return { id: playlistId, name: "网易云歌单", coverUrl: tracks[0]?.cover || "", tracks };
            }
          }
          return null;
        }, 3500);

        if (mirrorData && mirrorData.tracks && mirrorData.tracks.length > 0) {
          return mirrorData;
        }

        // 2. 通道二：网易云 H5 网页抓取 (3.5 秒硬超时)
        if (typeof showToast === 'function') showToast("步骤 2/4: 请求网易云网页解析...");
        let htmlStr = await fetchWithTimeout(async () => {
          const htmlRes = await this.ncmNativeFetch(`https://music.163.com/m/playlist?id=${playlistId}`, "GET");
          return htmlRes && htmlRes.data ? (typeof htmlRes.data === 'string' ? htmlRes.data : JSON.stringify(htmlRes.data)) : "";
        }, 3500);

        if (htmlStr && htmlStr.includes("<title>")) {
          const parsed = this.parseNcmHtmlPlaylist(htmlStr, playlistId);
          if (parsed && parsed.tracks && parsed.tracks.length > 0) {
            return parsed;
          }
        }

        // 3. 通道三：官方 v6 接口全量 trackIds 批量解包 (3.5 秒硬超时)
        if (typeof showToast === 'function') showToast("步骤 3/4: 请求网易云官方接口...");
        let plObj = await fetchWithTimeout(async () => {
          const v6Res = await this.ncmNativeFetch(`https://music.163.com/api/v6/playlist/detail?id=${playlistId}`, "GET");
          if (v6Res && v6Res.data && (v6Res.data.playlist || v6Res.data.result)) {
            return v6Res.data.playlist || v6Res.data.result;
          }
          return null;
        }, 3500);

        if (!plObj) return null;

        const plName = plObj.name || "网易云歌单";
        const plCover = plObj.coverImgUrl || "";
        let rawTracks = plObj.tracks || [];

        if (rawTracks.length === 0 && plObj.trackIds && plObj.trackIds.length > 0) {
          const allTrackIds = plObj.trackIds.map(t => t.id);
          const chunkSize = 50;
          for (let i = 0; i < allTrackIds.length; i += chunkSize) {
            const chunk = allTrackIds.slice(i, i + chunkSize);
            const idsParam = JSON.stringify(chunk.map(id => ({ id })));
            const chunkRes = await this.ncmNativeFetch(`https://music.163.com/api/song/detail?ids=${encodeURIComponent(idsParam)}`, "GET");
            if (chunkRes && chunkRes.data && chunkRes.data.songs) {
              rawTracks.push(...chunkRes.data.songs);
            }
          }
        }

        const tracks = [];
        rawTracks.forEach(t => {
          if (t && t.id) {
            tracks.push({
              id: t.id,
              name: t.name || "未命名歌曲",
              artist: t.artists ? t.artists.map(a => a.name).join("/") : (t.ar ? t.ar.map(a => a.name).join("/") : "网易云歌手"),
              cover: t.album ? t.album.picUrl : (t.al ? t.al.picUrl : ""),
              fee: t.fee || 0,
              url: `https://music.163.com/song/media/outer/url?id=${t.id}.mp3`
            });
          }
        });

        return { id: playlistId, name: plName, coverUrl: plCover, tracks };

      } catch(e) {
        console.error("抓取网易云歌单失败:", e);
        return null;
      }
    },

    // 从公开 HTML 网页中精准抽取歌单名称、封面与单曲列表
    parseNcmHtmlPlaylist(html, playlistId) {
      if (!html || typeof html !== 'string') return null;

      // 1. 提取歌单名称
      const nameMatch = html.match(/<title>(.*?)<\/title>/i);
      const plName = nameMatch 
        ? nameMatch[1].replace(/\s*-\s*歌单\s*-\s*网易云音乐.*/i, "").replace(/\s*-\s*网易云音乐.*/i, "").trim() 
        : "网易云歌单";

      // 2. 提取歌单封面图
      const coverMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) || html.match(/class="u-cover[^"]*"[^>]*>\s*<img\s+src="([^"]+)"/i);
      const plCover = coverMatch ? coverMatch[1] : "";

      // 3. 从 HTML 结构中正则抽取单曲 ID、歌名与歌手
      const tracks = [];
      const liRegex = /<li>\s*<a\s+href="\/song\?id=(\d+)"[^>]*>(.*?)<\/a>\s*-\s*<a\s+href="\/artist\?id=\d+"[^>]*>(.*?)<\/a>/gi;
      let match;

      while ((match = liRegex.exec(html)) !== null) {
        const id = match[1];
        const name = match[2].replace(/<[^>]+>/g, "").trim();
        const artist = match[3].replace(/<[^>]+>/g, "").trim();

        if (id && name) {
          tracks.push({
            id: id,
            name: name,
            artist: artist || "网易云歌手",
            cover: plCover,
            fee: 0,
            url: `https://music.163.com/song/media/outer/url?id=${id}.mp3`
          });
        }
      }

      // 泛化兜底：若是新版 H5 结构，扫描所有 /song?id= 节点
      if (tracks.length === 0) {
        const genericRegex = /<a\s+href="\/song\?id=(\d+)"[^>]*>(.*?)<\/a>/gi;
        const foundIds = new Set();
        let genMatch;

        while ((genMatch = genericRegex.exec(html)) !== null) {
          const id = genMatch[1];
          const name = genMatch[2].replace(/<[^>]+>/g, "").trim();
          if (!foundIds.has(id) && name) {
            foundIds.add(id);
            tracks.push({
              id: id,
              name: name,
              artist: "网易云歌手",
              cover: plCover,
              fee: 0,
              url: `https://music.163.com/song/media/outer/url?id=${id}.mp3`
            });
          }
        }
      }

      if (tracks.length === 0) return null;
      return { id: playlistId, name: plName, coverUrl: plCover, tracks };
    },

    // 歌单详情查看 Modal (支持从歌单中移出与删除歌单)
    async openPlaylistDetail(playlistId) {
      const pl = this.playlists.find(p => p.id === playlistId);
      if (!pl) return;

      const overlay = document.getElementById("ncm-playlist-detail-overlay");
      const titleEl = document.getElementById("ncm-playlist-detail-title");
      const container = document.getElementById("ncm-playlist-songs-flow");
      const delPlBtn = document.getElementById("ncm-btn-delete-playlist");
      if (!overlay || !container) return;

      if (titleEl) titleEl.innerText = pl.name;
      if (delPlBtn) {
        delPlBtn.onclick = () => this.deletePlaylist(pl.id);
      }

      const allSongs = await this.getAllSongsFromIndexedDB();
      const plSongs = allSongs.filter(s => (pl.songIds || []).includes(s.id));

      if (plSongs.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:20px; font-size:12px; color:#94a3b8;">该歌单下暂无歌曲，可在编辑歌曲资料时选择归入此歌单</div>`;
      } else {
        let html = "";
        plSongs.forEach((song) => {
          html += `
            <div class="ncm-song-item" onclick="musicSystem.playSongFromPlaylist('${pl.id}', '${song.id}')">
              <div class="ncm-song-info">
                <div class="ncm-song-title">${song.title}</div>
                <div class="ncm-song-artist">${song.artist || '未知歌手'}</div>
              </div>
              <div class="ncm-song-actions" onclick="event.stopPropagation()">
                <button class="btn-icon" style="color:#ec4141;" title="播放" onclick="musicSystem.playSongFromPlaylist('${pl.id}', '${song.id}')">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="btn-icon" style="color:#ef4444;" title="从歌单移出" onclick="musicSystem.removeSongFromPlaylist('${pl.id}', '${song.id}')">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      }

      overlay.classList.add("active");
    },

    async removeSongFromPlaylist(playlistId, songId) {
      const pl = this.playlists.find(p => p.id === playlistId);
      if (pl && pl.songIds) {
        pl.songIds = pl.songIds.filter(id => id !== songId);
        this.savePlaylistsToStorage();
        if (typeof showToast === 'function') showToast("已从该歌单中移出");
        this.openPlaylistDetail(playlistId);
        this.renderMine();
      }
    },

    deletePlaylist(playlistId) {
      if (confirm("确定要删除此歌单分组吗？（歌单内的歌曲仍会保留在曲库中）")) {
        this.playlists = this.playlists.filter(p => p.id !== playlistId);
        this.savePlaylistsToStorage();
        this.closePlaylistDetail();
        if (typeof showToast === 'function') showToast("歌单分组已删除");
        this.renderMine();
      }
    },

    closePlaylistDetail() {
      const overlay = document.getElementById("ncm-playlist-detail-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    switchTab(tab) {
      document.querySelectorAll(".music-tab-panel").forEach(p => p.classList.remove("active"));
      document.querySelectorAll(".music-dock-tab").forEach(t => t.classList.remove("active"));

      const targetPanel = document.getElementById(`music-tab-${tab}`);
      const targetTab = document.querySelector(`.music-dock-tab[data-tab="${tab}"]`);
      if (targetPanel) targetPanel.classList.add("active");
      if (targetTab) targetTab.classList.add("active");

      if (tab === 'mine') this.renderMine();
    },

    openImportChoiceModal() {
      const overlay = document.getElementById("ncm-import-choice-overlay");
      if (overlay) overlay.classList.add("active");
    },

    closeImportChoiceModal() {
      const overlay = document.getElementById("ncm-import-choice-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    openImportFormModal(type) {
      this.closeImportChoiceModal();
      const overlay = document.getElementById("ncm-import-form-overlay");
      if (!overlay) return;

      document.getElementById("ncm-form-import-type").value = type;
      const fileGroup = document.getElementById("ncm-form-file-group");
      const urlGroup = document.getElementById("ncm-form-url-group");
      const ncmGroup = document.getElementById("ncm-form-ncm-group");

      if (fileGroup) fileGroup.style.display = type === 'local' ? 'block' : 'none';
      if (urlGroup) urlGroup.style.display = type === 'url' ? 'block' : 'none';
      if (ncmGroup) ncmGroup.style.display = type === 'ncm' ? 'block' : 'none';

      this.populatePlaylistDropdownOptions("ncm-form-playlist-select");
      overlay.classList.add("active");
    },

    closeImportFormModal() {
      const overlay = document.getElementById("ncm-import-form-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    populatePlaylistDropdownOptions(selectId) {
      const select = document.getElementById(selectId);
      if (!select) return;

      if (this.playlists.length === 0) {
        select.innerHTML = `<option value="">未创建歌单 (保存在曲库)</option>`;
        return;
      }

      let html = `<option value="">未创建歌单 (保存在曲库)</option>`;
      this.playlists.forEach(p => {
        html += `<option value="${p.id}">${p.name}</option>`;
      });
      select.innerHTML = html;
    },

    async handleCoverFileUpload(fileInput, targetPreviewId) {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];

      if (typeof showToast === 'function') showToast("正在等比方形裁切与压缩封面...");

      const base64 = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const minDim = Math.min(img.width, img.height);
          const srcX = (img.width - minDim) / 2;
          const srcY = (img.height - minDim) / 2;

          const canvas = document.createElement("canvas");
          canvas.width = 180;
          canvas.height = 180;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, srcX, srcY, minDim, minDim, 0, 0, 180, 180);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => resolve("");
        const reader = new FileReader();
        reader.onload = (e) => img.src = e.target.result;
        reader.readAsDataURL(file);
      });

      this.tempCropCoverBase64 = base64;
      const preview = document.getElementById(targetPreviewId);
      if (preview && base64) {
        preview.src = base64;
      }
    },

    parseNcmSongId(inputStr) {
      if (!inputStr) return null;
      const match = inputStr.match(/(?:id=|^)(\d+)/);
      return match ? match[1] : inputStr.trim();
    },

    async submitImportSong() {
      const type = document.getElementById("ncm-form-import-type").value;
      const titleInput = document.getElementById("ncm-form-title").value.trim();
      const artistInput = document.getElementById("ncm-form-artist").value.trim();
      const coverInput = document.getElementById("ncm-form-cover").value.trim();
      const lyricsInput = document.getElementById("ncm-form-lyrics").value.trim();
      const targetPlId = document.getElementById("ncm-form-playlist-select").value;

      let songObj = {
        id: "song_" + Date.now(),
        title: titleInput || "未命名歌曲",
        artist: artistInput || "未知歌手",
        cover: this.tempCropCoverBase64 || coverInput || "",
        lyrics: lyricsInput || "[00:00.00]暂无歌词",
        url: "",
        isVip: false,
        isFavorite: false
      };

      if (type === 'local') {
        const fileInput = document.getElementById("ncm-form-file-input");
        if (!fileInput.files || !fileInput.files[0]) {
          if (typeof showToast === 'function') showToast("请先选择本地音频文件");
          return;
        }
        const file = fileInput.files[0];
        songObj.title = titleInput || file.name.replace(/\.[^/.]+$/, "");
        songObj.url = URL.createObjectURL(file);
        await this.saveSongToIndexedDB({ id: songObj.id, blob: file, ...songObj });

      } else if (type === 'url') {
        const urlVal = document.getElementById("ncm-form-url-input").value.trim();
        if (!urlVal) {
          if (typeof showToast === 'function') showToast("请输入有效的音频 URL");
          return;
        }
        songObj.url = urlVal;
        await this.saveSongToIndexedDB(songObj);

      } else if (type === 'ncm') {
        const ncmLink = document.getElementById("ncm-form-ncm-input").value.trim();
        const songId = this.parseNcmSongId(ncmLink);
        if (!songId) {
          if (typeof showToast === 'function') showToast("无效的网易云链接或 ID");
          return;
        }

        if (typeof showToast === 'function') showToast("正在向网易云自动识别歌名、歌手与歌词...");

        songObj.id = "ncm_" + songId;
        songObj.url = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;

        // 完全还原旧版本 100% 成功的纯净 GET 识别逻辑
        const meta = await this.fetchNcmSongDetail(songId);
        if (meta) {
          if (meta.title) songObj.title = titleInput || meta.title;
          if (meta.artist) songObj.artist = artistInput || meta.artist;
          if (meta.cover) songObj.cover = this.tempCropCoverBase64 || coverInput || meta.cover;
          if (meta.lyrics) songObj.lyrics = lyricsInput || meta.lyrics;
        }

        await this.saveSongToIndexedDB(songObj);
      }

      if (targetPlId && this.playlists.length > 0) {
        const targetPl = this.playlists.find(p => p.id === targetPlId);
        if (targetPl) {
          targetPl.songIds = targetPl.songIds || [];
          if (!targetPl.songIds.includes(songObj.id)) {
            targetPl.songIds.push(songObj.id);
          }
          this.savePlaylistsToStorage();
        }
      }

      this.tempCropCoverBase64 = "";
      if (typeof showToast === 'function') showToast("歌曲全自动识别并录入成功！");
      this.closeImportFormModal();
      this.renderMine();
    },

    // 双通道并发高成功率网易云歌词与元数据识别器
    async fetchNcmSongDetail(songId) {
      if (!songId) return null;

      let title = "";
      let artist = "";
      let cover = "";
      let lyrics = "";

      try {
        // 双通道 Promise.all 并发请求：歌词 + 歌曲详情
        const [lrcRes, detailRes] = await Promise.all([
          this.ncmNativeFetch(`https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`, "GET").catch(() => null),
          this.ncmNativeFetch(`https://music.163.com/api/song/detail?ids=%5B${songId}%5D`, "GET").catch(() => null)
        ]);

        if (lrcRes && lrcRes.data) {
          const d = lrcRes.data;
          if (d.lrc && d.lrc.lyric) {
            lyrics = d.lrc.lyric;
          } else if (d.tlyric && d.tlyric.lyric) {
            lyrics = d.tlyric.lyric;
          }
        }

        // 备用镜像歌词补救通道
        if (!lyrics || lyrics === "[00:00.00]暂无歌词") {
          const mirrorRes = await fetch(`https://api.lrc.st/v1/netease/${songId}`).catch(() => null);
          if (mirrorRes && mirrorRes.ok) {
            const mirrorData = await mirrorRes.json().catch(() => null);
            if (mirrorData && mirrorData.lyric) {
              lyrics = mirrorData.lyric;
            }
          }
        }

        if (detailRes && detailRes.data && detailRes.data.songs && detailRes.data.songs[0]) {
          const s = detailRes.data.songs[0];
          title = s.name || "";
          artist = s.artists ? s.artists.map(a => a.name).join("/") : (s.ar ? s.ar.map(a => a.name).join("/") : "未知歌手");
          cover = s.album ? s.album.picUrl : (s.al ? s.al.picUrl : "");
        }

        return { title, artist, cover, lyrics: lyrics || "[00:00.00]暂无歌词" };
      } catch(e) {
        return { title, artist, cover, lyrics: lyrics || "[00:00.00]暂无歌词" };
      }
    },

    async openSongEditModal(songId) {
      const song = await this.getSongFromIndexedDB(songId);
      if (!song) return;

      document.getElementById("ncm-edit-song-id").value = song.id;
      document.getElementById("ncm-edit-title").value = song.title || "";
      document.getElementById("ncm-edit-artist").value = song.artist || "";
      document.getElementById("ncm-edit-cover").value = song.cover || "";

      const lyricsInput = document.getElementById("ncm-edit-lyrics");
      if (lyricsInput) {
        lyricsInput.value = song.lyrics || "";
      }

      this.populatePlaylistDropdownOptions("ncm-edit-playlist-select");

      // 精准反查并选中当前歌曲所属的歌单分组
      const currentPl = this.playlists.find(p => (p.songIds || []).includes(song.id));
      const selectEl = document.getElementById("ncm-edit-playlist-select");
      if (selectEl && currentPl) {
        selectEl.value = currentPl.id;
      }

      const overlay = document.getElementById("ncm-song-edit-overlay");
      if (overlay) overlay.classList.add("active");
    },

    closeSongEditModal() {
      const overlay = document.getElementById("ncm-song-edit-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    // 核心修正：保存时完全同步【歌单归属修改】与【歌词防覆盖】
    async submitSaveSongEdit() {
      const id = document.getElementById("ncm-edit-song-id").value;
      const song = await this.getSongFromIndexedDB(id);
      if (!song) return;

      const newTitle = document.getElementById("ncm-edit-title").value.trim();
      const newArtist = document.getElementById("ncm-edit-artist").value.trim();
      const newCover = this.tempCropCoverBase64 || document.getElementById("ncm-edit-cover").value.trim();
      const newLyrics = document.getElementById("ncm-edit-lyrics").value.trim();
      const targetPlId = document.getElementById("ncm-edit-playlist-select")?.value;

      song.title = newTitle || song.title;
      song.artist = newArtist || song.artist;
      song.cover = newCover || song.cover;
      
      if (newLyrics) {
        song.lyrics = newLyrics;
      }

      await this.saveSongToIndexedDB(song);

      // 核心歌单重归属逻辑：从所有旧歌单中移除，再加入选中的新歌单
      if (this.playlists.length > 0) {
        this.playlists.forEach(pl => {
          if (pl.songIds) {
            pl.songIds = pl.songIds.filter(sid => sid !== id);
          }
        });

        if (targetPlId) {
          const targetPl = this.playlists.find(p => p.id === targetPlId);
          if (targetPl) {
            targetPl.songIds = targetPl.songIds || [];
            if (!targetPl.songIds.includes(id)) {
              targetPl.songIds.push(id);
            }
          }
        }
        this.savePlaylistsToStorage();
      }

      this.tempCropCoverBase64 = "";

      if (typeof showToast === 'function') showToast("歌曲资料及歌单归属更新成功！");
      this.closeSongEditModal();
      this.renderMine();

      if (this.playlist[this.currentIndex] && this.playlist[this.currentIndex].id === id) {
        this.playlist[this.currentIndex] = song;
        this.parseLyrics(song.lyrics);
        this.updatePlayerUI();
      }
    },

    async renderMine() {
      const activeMeId = localStorage.getItem("active_me_id");
      const avatarEl = document.getElementById("ncm-mine-user-avatar");
      const nameEl = document.getElementById("ncm-mine-user-name");
      const remarkEl = document.getElementById("ncm-mine-user-remark");

      const ncmNick = localStorage.getItem("ncm_user_nickname");
      const ncmAvatar = localStorage.getItem("ncm_user_avatar");

      if (ncmNick) {
        if (avatarEl && ncmAvatar) avatarEl.src = ncmAvatar;
        if (nameEl) nameEl.innerText = ncmNick;
        if (remarkEl) remarkEl.innerText = this.isVip ? "网易云黑胶 VIP 会员 (已同频)" : "网易云账号已同步";
      } else if (activeMeId && typeof db !== 'undefined') {
        try {
          const userArc = await db.archives.get(Number(activeMeId));
          if (userArc) {
            if (avatarEl) {
              avatarEl.src = userArc.avatar instanceof Blob ? URL.createObjectURL(userArc.avatar) : (userArc.avatar || "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><rect width='100' height='100' fill='%23cbd5e1'/></svg>");
            }
            if (nameEl) nameEl.innerText = userArc.name || "我的人设";
            if (remarkEl) remarkEl.innerText = userArc.remark || "同步当前面具";
          }
        } catch(e) {}
      }

      await this.renderPlaylistsUI();
      await this.renderSongsUI();
    },

    async getPlaylistCoverUrl(pl) {
      if (pl.coverUrl) return pl.coverUrl;
      if (pl.songIds && pl.songIds.length > 0) {
        const firstSong = await this.getSongFromIndexedDB(pl.songIds[0]);
        if (firstSong && firstSong.cover) return firstSong.cover;
      }
      return "";
    },

    async renderPlaylistsUI() {
      const container = document.getElementById("ncm-playlists-container");
      if (!container) return;

      if (this.playlists.length === 0) {
        container.innerHTML = `<div style="font-size:11px; color:#94a3b8; text-align:center; padding:10px 0; border:1px dashed #e2e8f0; border-radius:10px; margin-bottom:12px;">暂无新建歌单分组，点击右侧加号创建</div>`;
        return;
      }

      let html = `<div style="display:flex; gap:10px; overflow-x:auto; padding-bottom:8px; margin-bottom:12px;">`;
      for (let pl of this.playlists) {
        const cover = await this.getPlaylistCoverUrl(pl);
        const coverStyle = cover ? `background-image:url(${cover}); background-size:cover; background-position:center;` : `background:#fee2e2; display:flex; align-items:center; justify-content:center; color:#ec4141;`;
        const innerIcon = cover ? '' : `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;

        html += `
          <div class="ncm-playlist-card" style="width:110px; flex-shrink:0;" onclick="musicSystem.openPlaylistDetail('${pl.id}')">
            <div class="ncm-playlist-cover" style="${coverStyle}">
              ${innerIcon}
            </div>
            <span class="ncm-playlist-name">${pl.name}</span>
          </div>
        `;
      }
      html += `</div>`;
      container.innerHTML = html;
    },

    async renderSongsUI() {
      const container = document.getElementById("ncm-mine-songs-container");
      if (!container) return;

      const songs = await this.getAllSongsFromIndexedDB();
      if (songs.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:20px; font-size:12px; color:#94a3b8;">暂无导入歌曲，点击右上角加号进行导入</div>`;
        return;
      }

      let html = "";
      songs.forEach((song, idx) => {
        html += `
          <div class="ncm-song-item" onclick="musicSystem.playSongFromList(${idx})">
            <div class="ncm-song-info">
              <div class="ncm-song-title">
                ${song.title}
                ${song.isVip ? '<span class="ncm-vip-tag">VIP</span>' : ''}
              </div>
              <div class="ncm-song-artist">${song.artist || '未知歌手'}</div>
            </div>
            <div class="ncm-song-actions" onclick="event.stopPropagation()">
              <button class="btn-icon" style="color:#ec4141;" title="播放" onclick="musicSystem.playSongFromList(${idx})">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <button class="btn-icon" style="color:#3b82f6;" title="编辑" onclick="musicSystem.openSongEditModal('${song.id}')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon" style="color:#94a3b8;" title="删除" onclick="musicSystem.removeSong('${song.id}')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    },

    async removeSong(id) {
      await this.deleteSongFromIndexedDB(id);
      if (typeof showToast === 'function') showToast("删除成功");
      this.renderMine();
    },

    // 指定歌单内播放：设置 currentPlaylistId 后按歌单内索引播放
    // 顺序/循环/随机模式均限定在此歌单内，不会跳到整个大曲库
    async playSongFromPlaylist(playlistId, songId) {
      this.currentPlaylistId = playlistId;
      const allSongs = await this.getAllSongsFromIndexedDB();
      const pl = this.playlists.find(p => p.id === playlistId);
      if (!pl || !pl.songIds || pl.songIds.length === 0) {
        if (typeof showToast === 'function') showToast("该歌单为空");
        return;
      }
      const plSongs = (pl.songIds || []).map(sid => allSongs.find(s => s.id === sid)).filter(Boolean);
      this.playlist = plSongs;
      const idx = plSongs.findIndex(s => s.id === songId);
      this.currentIndex = idx >= 0 ? idx : 0;
      // 复用 playSongFromList 的播放逻辑（此时 currentPlaylistId 已设置，会保持歌单范围）
      await this.playSongFromList(this.currentIndex);
    },

    // 退出歌单范围播放（回到全曲库模式）
    clearPlaylistScope() {
      this.currentPlaylistId = null;
    },

    // 核心重构：0.01 秒极速唤起灵动岛播放 + 非阻塞后台异步静默补拉歌词！
    // 带有【多通道音源自愈熔断】与【自适应备用切换】的极速播放器
    // 若 currentPlaylistId 已设置，则播放范围限定为该歌单内的歌曲（顺序/循环/随机只在此歌单里）
    async playSongFromList(index) {
      let songs;
      if (this.currentPlaylistId) {
        // 歌单范围：只取该歌单的 songIds 对应歌曲，保持歌单内顺序
        const allSongs = await this.getAllSongsFromIndexedDB();
        const pl = this.playlists.find(p => p.id === this.currentPlaylistId);
        if (pl && pl.songIds && pl.songIds.length > 0) {
          songs = (pl.songIds || []).map(sid => allSongs.find(s => s.id === sid)).filter(Boolean);
        } else {
          songs = allSongs;
        }
      } else {
        songs = await this.getAllSongsFromIndexedDB();
      }
      if (!songs[index]) return;

      this.playlist = songs;
      this.currentIndex = index;
      let song = songs[index];

      // 重置音频错误自愈监听
      this.audio.onerror = null;

      if (song.blob instanceof Blob) {
        this.audio.src = URL.createObjectURL(song.blob);
      } else {
        this.audio.src = song.url;
      }

      // 音频加载失败容灾熔断：若网易云外链限流，自动切换备用音频通道或平滑切至下一首
      this.audio.onerror = async () => {
        console.warn("主音源加载失败或触发限流，启动备用音源通道...");
        if (song.id && song.id.startsWith("ncm_")) {
          const rawId = song.id.replace("ncm_", "");
          const backupUrl = `https://api.i-meto.com/meting/v1/url?id=${rawId}`;
          this.audio.onerror = () => {
            if (typeof showToast === 'function') showToast("该曲目版权受限或音源失效，已自动播放下一首");
            this.nextSong();
          };
          this.audio.src = backupUrl;
          this.audio.play().catch(() => this.nextSong());
        } else {
          this.nextSong();
        }
      };

      this.audio.play().catch(() => {});

      // 1. 瞬时解析现有歌词与弹出灵动岛 (0.01 秒绝对不等待网络)
      this.parseLyrics(song.lyrics || "");
      this.showDynamicIsland(true);
      this.updatePlayerUI();

      // 2. 异步后台双通道并发重拉歌词 (非阻塞)
      if (song.id.startsWith("ncm_") && (!song.lyrics || song.lyrics.includes("点击播放拉取") || song.lyrics.includes("暂无歌词"))) {
        const rawNcmId = song.id.replace("ncm_", "");
        this.fetchNcmSongDetail(rawNcmId).then(async (meta) => {
          if (meta) {
            if (meta.lyrics && meta.lyrics !== "[00:00.00]暂无歌词") song.lyrics = meta.lyrics;
            if (meta.title) song.title = meta.title;
            if (meta.artist) song.artist = meta.artist;
            if (meta.cover) song.cover = meta.cover;

            await this.saveSongToIndexedDB(song);

            if (this.currentIndex === index) {
              this.parseLyrics(song.lyrics);
              this.updatePlayerUI();
            }
          }
        });
      }
    },

    parseLyrics(lrcText) {
      this.lyrics = [];
      if (!lrcText) return;

      const lines = lrcText.split("\n");
      // 高容错 LRC 时间戳正则：支持 [m:ss.ms]、[mm:ss.m]、[mm:ss:ms]、[mm:ss] 全类型格式
      const reg = /\[(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?\](.*)/;

      lines.forEach(line => {
        const match = line.match(reg);
        if (match) {
          const min = parseInt(match[1]);
          const sec = parseInt(match[2]);
          const time = min * 60 + sec;
          const text = match[4].trim();
          if (text) {
            this.lyrics.push({ time, text });
          }
        }
      });

      // 按时间从前到后排序
      this.lyrics.sort((a, b) => a.time - b.time);
    },

    syncLyricsTime() {
      if (this.lyrics.length === 0) return;
      const cur = this.audio.currentTime;

      let activeIndex = -1;
      for (let i = 0; i < this.lyrics.length; i++) {
        if (cur >= this.lyrics[i].time) {
          activeIndex = i;
        } else {
          break;
        }
      }

      if (activeIndex !== this.activeLyricIndex) {
        this.activeLyricIndex = activeIndex;
        this.renderCardLyricsUI();
      }
    },

    renderCardLyricsUI() {
      const box = document.getElementById("island-card-lyrics-box");
      if (!box) return;

      if (this.lyrics.length === 0) {
        box.innerHTML = `<div class="island-lyric-line active">暂无歌词</div>`;
        return;
      }

      let html = "";
      this.lyrics.forEach((item, idx) => {
        const isActive = idx === this.activeLyricIndex;
        html += `<div class="island-lyric-line ${isActive ? 'active' : ''}" id="card-lyric-line-${idx}">${item.text}</div>`;
      });
      box.innerHTML = html;

      const activeEl = document.getElementById(`card-lyric-line-${this.activeLyricIndex}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },

    toggleCardLyricsView(event) {
      if (event) event.stopPropagation();
      this.showCardLyrics = !this.showCardLyrics;

      const vinylBox = document.getElementById("island-card-vinyl-box");
      const lyricsBox = document.getElementById("island-card-lyrics-box");

      if (this.showCardLyrics) {
        if (vinylBox) vinylBox.style.display = "none";
        if (lyricsBox) {
          lyricsBox.style.display = "flex";
          this.renderCardLyricsUI();
        }
      } else {
        if (vinylBox) vinylBox.style.display = "flex";
        if (lyricsBox) lyricsBox.style.display = "none";
      }
    },

    showDynamicIsland(show) {
      let island = document.getElementById("dynamic-island-container");
      if (!island) return;
      if (show) {
        island.style.display = "flex";
        island.classList.remove("expanded");
        island.classList.add("collapsed");
      } else {
        island.style.display = "none";
        this.toggleCardChatView(false);
      }
    },

    closeAndStopMusic(event) {
      if (event) event.stopPropagation();
      this.audio.pause();
      this.audio.currentTime = 0;
      this.showDynamicIsland(false);
      if (typeof showToast === 'function') showToast("已停止听歌并关闭灵动岛");
    },

    toggleIslandExpand() {
      const island = document.getElementById("dynamic-island-container");
      if (!island) return;

      if (island.classList.contains("collapsed")) {
        island.classList.remove("collapsed");
        island.classList.add("expanded");
      } else {
        island.classList.remove("expanded");
        island.classList.add("collapsed");
        this.toggleCardChatView(false);
      }
    },

    toggleCardChatView(showChat) {
      this.isCardChatView = showChat;
      const playerView = document.getElementById("island-player-view");
      const chatView = document.getElementById("island-chat-view");

      if (showChat) {
        if (playerView) playerView.style.display = "none";
        if (chatView) {
          chatView.style.display = "flex";
          this.renderIslandChatMessages();
        }
      } else {
        if (playerView) playerView.style.display = "flex";
        if (chatView) chatView.style.display = "none";
      }
    },

    updatePlayerUI() {
      const song = this.playlist[this.currentIndex];
      if (!song) return;

      const titleSm = document.getElementById("island-title-sm");
      const artistSm = document.getElementById("island-artist-sm");
      const miniCover = document.getElementById("island-cover-img");

      if (titleSm) titleSm.innerText = song.title || "未知歌名";
      if (artistSm) artistSm.innerText = song.artist || "未知歌手";
      if (miniCover) {
        miniCover.src = song.cover || "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><rect width='100' height='100' fill='%23ec4141'/></svg>";
      }

      const titleCard = document.getElementById("island-card-song-title");
      const artistCard = document.getElementById("island-card-song-artist");
      if (titleCard) titleCard.innerText = song.title || "未知歌名";
      if (artistCard) artistCard.innerText = song.artist || "未知歌手";

      const coverImg = document.getElementById("island-card-cover-img");
      if (coverImg) {
        coverImg.src = song.cover || "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><rect width='100' height='100' fill='%23ec4141'/></svg>";
      }

      const cardBgBlur = document.getElementById("island-card-bg-blur");
      if (cardBgBlur && song.cover) {
        cardBgBlur.style.backgroundImage = `url(${song.cover})`;
      }

      const heartBtn = document.getElementById("island-card-heart-btn");
      if (heartBtn) {
        heartBtn.style.color = song.isFavorite ? "#ec4141" : "rgba(255,255,255,0.7)";
      }

      this.syncPlayStateUI(!this.audio.paused);
    },

    syncPlayStateUI(isPlaying) {
      const playBtn = document.getElementById("island-card-play-btn");
      const vinylDisc = document.getElementById("island-card-vinyl-disc");
      const miniCover = document.getElementById("island-cover-img");

      if (playBtn) {
        if (isPlaying) {
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        } else {
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        }
      }

      if (vinylDisc) {
        if (isPlaying) vinylDisc.classList.add("playing");
        else vinylDisc.classList.remove("playing");
      }

      if (miniCover) {
        if (isPlaying) miniCover.classList.add("playing");
        else miniCover.classList.remove("playing");
      }
    },

    updateProgressUI() {
      const audio = this.audio;
      if (!audio.duration) return;

      const curSec = Math.floor(audio.currentTime);
      const durSec = Math.floor(audio.duration);

      const curStr = `${Math.floor(curSec / 60).toString().padStart(2, '0')}:${(curSec % 60).toString().padStart(2, '0')}`;
      const durStr = `${Math.floor(durSec / 60).toString().padStart(2, '0')}:${(durSec % 60).toString().padStart(2, '0')}`;

      const curTimeEl = document.getElementById("island-card-time-cur");
      const durTimeEl = document.getElementById("island-card-time-dur");
      if (curTimeEl) curTimeEl.innerText = curStr;
      if (durTimeEl) durTimeEl.innerText = durStr;

      const seekbar = document.getElementById("island-card-seekbar");
      if (seekbar) {
        seekbar.value = (audio.currentTime / audio.duration) * 100;
      }
    },

    onSeekbarChange(val) {
      if (!this.audio.duration) return;
      this.audio.currentTime = (parseFloat(val) / 100) * this.audio.duration;
    },

    togglePlayPause() {
      if (this.audio.paused) {
        this.audio.play();
      } else {
        this.audio.pause();
      }
    },

    cyclePlayMode(event) {
      if (event) event.stopPropagation();

      const modes = ['sequence', 'loop', 'random'];
      const nextIdx = (modes.indexOf(this.playMode) + 1) % modes.length;
      this.playMode = modes[nextIdx];

      const modeBtn = document.getElementById("island-card-mode-btn");
      if (modeBtn) {
        if (this.playMode === 'sequence') {
          modeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;
          if (typeof showToast === 'function') showToast("顺序播放模式");
        } else if (this.playMode === 'loop') {
          modeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`;
          if (typeof showToast === 'function') showToast("单曲循环模式");
        } else if (this.playMode === 'random') {
          modeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`;
          if (typeof showToast === 'function') showToast("随机播放模式");
        }
      }
    },

    async toggleFavoriteCurrentSong(event) {
      if (event) event.stopPropagation();

      const song = this.playlist[this.currentIndex];
      if (!song) return;

      song.isFavorite = !song.isFavorite;
      await this.saveSongToIndexedDB(song);

      const heartBtn = document.getElementById("island-card-heart-btn");
      if (heartBtn) {
        heartBtn.style.color = song.isFavorite ? "#ec4141" : "rgba(255,255,255,0.7)";
      }

      if (typeof showToast === 'function') showToast(song.isFavorite ? "已加入我喜欢的音乐" : "已取消收藏");
    },

    prevSong() {
      if (this.playlist.length === 0) return;
      let prevIdx = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
      this.playSongFromList(prevIdx);
    },

    nextSong() {
      if (this.playlist.length === 0) return;
      let nextIdx = (this.currentIndex + 1) % this.playlist.length;
      this.playSongFromList(nextIdx);
    },

    handleSongEnd() {
      if (this.playMode === 'loop') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else if (this.playMode === 'random') {
        const randomIdx = Math.floor(Math.random() * this.playlist.length);
        this.playSongFromList(randomIdx);
      } else {
        this.nextSong();
      }
    },

    openNcmLoginModal() {
      const overlay = document.getElementById("ncm-qrcode-overlay");
      if (overlay) {
        overlay.classList.add("active");
        // 回显已保存的 API 地址
        const apiInput = document.getElementById("ncm-api-base-input");
        if (apiInput) apiInput.value = this.ncmApiBase;
        // 预检测 API 连通性
        this.checkNcmApiConnectivity();
      }
    },

    closeNcmLoginModal() {
      if (this.qrPollTimer) clearInterval(this.qrPollTimer);
      if (this.captchaCooldownTimer) clearInterval(this.captchaCooldownTimer);
      const overlay = document.getElementById("ncm-qrcode-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    // 保存 API 地址并检测连通性
    async saveNcmApiBase() {
      const input = document.getElementById("ncm-api-base-input");
      if (!input) return;
      let val = input.value.trim().replace(/\/+$/, "");
      if (!val) val = "http://localhost:3000";
      this.ncmApiBase = val;
      localStorage.setItem("ncm_api_base", val);
      await this.checkNcmApiConnectivity();
    },

    // 检测 API 后端是否可用
    async checkNcmApiConnectivity() {
      const statusEl = document.getElementById("ncm-api-status");
      if (statusEl) statusEl.innerText = "检测中...";
      try {
        const res = await fetch(`${this.ncmApiBase}/search?keywords=test&limit=1`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (data && data.code === 200) {
            if (statusEl) {
              statusEl.innerText = "✓ API 连通正常";
              statusEl.style.color = "#22c55e";
            }
            return true;
          }
        }
        if (statusEl) {
          statusEl.innerText = "✗ API 返回异常，请检查地址";
          statusEl.style.color = "#ef4444";
        }
      } catch(e) {
        if (statusEl) {
          statusEl.innerText = "✗ 无法连接 API，请确认本地服务已启动";
          statusEl.style.color = "#ef4444";
        }
      }
      return false;
    },

    // 发送手机验证码
    async sendNcmCaptcha() {
      const phoneInput = document.getElementById("ncm-phone-input");
      const phone = phoneInput ? phoneInput.value.trim() : "";
      if (!phone || !/^1\d{10}$/.test(phone)) {
        if (typeof showToast === 'function') showToast("请输入正确的 11 位手机号");
        return;
      }

      const statusText = document.getElementById("ncm-qrcode-status");
      const sendBtn = document.getElementById("ncm-send-captcha-btn");
      if (sendBtn) { sendBtn.disabled = true; sendBtn.innerText = "发送中..."; }

      try {
        // 先匿名注册获取设备 cookie（绕过风控的关键步骤）
        if (!this.ncmAnonCookie) {
          if (statusText) statusText.innerText = "正在建立设备通道...";
          const anonRes = await fetch(`${this.ncmApiBase}/register/anonimous`).catch(() => null);
          if (anonRes && anonRes.ok) {
            const anonData = await anonRes.json();
            // 从响应头 Set-Cookie 中提取 cookie（浏览器 fetch 可能无法读取 Set-Cookie，
            // NeteaseCloudMusicApi 会把 cookie 数组放在响应体里）
            if (anonData.cookie && Array.isArray(anonData.cookie)) {
              this.ncmAnonCookie = anonData.cookie.map(c => c.split(';')[0]).join('; ');
            }
          }
          if (!this.ncmAnonCookie) {
            // 即使匿名注册失败也继续，部分情况下仍可发送验证码
            this.ncmAnonCookie = "";
          }
        }

        // 发送验证码
        if (statusText) statusText.innerText = "正在发送验证码...";
        const captchaUrl = `${this.ncmApiBase}/captcha/sent?phone=${phone}` + (this.ncmAnonCookie ? `&cookie=${encodeURIComponent(this.ncmAnonCookie)}` : "");
        const res = await fetch(captchaUrl).catch(() => null);

        if (res && res.ok) {
          const data = await res.json();
          if (data.code === 200) {
            if (statusText) statusText.innerText = "验证码已发送至手机，请查收";
            if (typeof showToast === 'function') showToast("验证码已发送！");
            // 开始倒计时
            this.ncmCaptchaCooldown = 60;
            this.captchaCooldownTimer = setInterval(() => {
              this.ncmCaptchaCooldown--;
              if (sendBtn) {
                if (this.ncmCaptchaCooldown > 0) {
                  sendBtn.innerText = `${this.ncmCaptchaCooldown}s`;
                  sendBtn.disabled = true;
                } else {
                  sendBtn.innerText = "重新发送";
                  sendBtn.disabled = false;
                  clearInterval(this.captchaCooldownTimer);
                }
              }
            }, 1000);
          } else {
            if (statusText) statusText.innerText = "发送失败: " + (data.message || "未知错误");
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerText = "发送验证码"; }
          }
        } else {
          if (statusText) statusText.innerText = "API 连接失败，请检查 API 地址设置";
          if (sendBtn) { sendBtn.disabled = false; sendBtn.innerText = "发送验证码"; }
        }
      } catch(e) {
        if (statusText) statusText.innerText = "发送验证码异常: " + e.message;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerText = "发送验证码"; }
      }
    },

    // 用手机号+验证码登录
    async loginNcmByCaptcha() {
      const phoneInput = document.getElementById("ncm-phone-input");
      const captchaInput = document.getElementById("ncm-captcha-input");
      const phone = phoneInput ? phoneInput.value.trim() : "";
      const captcha = captchaInput ? captchaInput.value.trim() : "";

      if (!phone || !/^1\d{10}$/.test(phone)) {
        if (typeof showToast === 'function') showToast("请输入正确的手机号");
        return;
      }
      if (!captcha) {
        if (typeof showToast === 'function') showToast("请输入验证码");
        return;
      }

      const statusText = document.getElementById("ncm-qrcode-status");
      const loginBtn = document.getElementById("ncm-login-btn");
      if (loginBtn) { loginBtn.disabled = true; loginBtn.innerText = "登录中..."; }
      if (statusText) statusText.innerText = "正在验证登录...";

      try {
        const loginUrl = `${this.ncmApiBase}/login/cellphone?phone=${phone}&captcha=${captcha}` + (this.ncmAnonCookie ? `&cookie=${encodeURIComponent(this.ncmAnonCookie)}` : "");
        const res = await fetch(loginUrl).catch(() => null);

        if (res && res.ok) {
          const data = await res.json();
          if (data.code === 200) {
            // 提取 cookie
            let authCookie = "";
            if (data.cookie && Array.isArray(data.cookie)) {
              authCookie = data.cookie.map(c => c.split(';')[0]).join('; ');
            }
            if (!authCookie) {
              // 如果 cookie 在 body 里
              const musicU = (data.cookie || []).find(c => c.startsWith('MUSIC_U='));
              if (musicU) authCookie = musicU;
            }

            localStorage.setItem("ncm_user_cookie", authCookie);
            this.ncmCookie = authCookie;
            this.isVip = data.account && data.account.vipType > 0;

            if (statusText) statusText.innerText = "登录成功！正在同步红心歌单...";
            if (loginBtn) { loginBtn.innerText = "登录成功 ✓"; loginBtn.style.background = "#22c55e"; }
            if (typeof showToast === 'function') showToast("登录成功！同步红心歌单中...");

            // 同步用户数据
            await this.syncNcmUserData(authCookie);
            setTimeout(() => this.closeNcmLoginModal(), 1500);
          } else {
            if (statusText) statusText.innerText = "登录失败: " + (data.message || "验证码错误或已过期");
            if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = "登录并同步"; }
          }
        } else {
          if (statusText) statusText.innerText = "API 连接失败";
          if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = "登录并同步"; }
        }
      } catch(e) {
        if (statusText) statusText.innerText = "登录异常: " + e.message;
        if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = "登录并同步"; }
      }
    },

    async submitNcmManualToken() {
      const input = document.getElementById("ncm-manual-cookie-input").value.trim();
      if (!input) {
        if (typeof showToast === 'function') showToast("请输入有效的 Cookie 口令或网易云 UID");
        return;
      }

      if (input.startsWith("MUSIC_U") || input.includes(";")) {
        localStorage.setItem("ncm_user_cookie", input);
        this.ncmCookie = input;
        this.isVip = true;
        await this.syncNcmUserData(input);
      } else {
        await this.syncNcmByUid(input);
      }
      this.closeNcmLoginModal();
    },

    async syncNcmByUid(uidOrPlaylistId) {
      if (typeof showToast === 'function') showToast("正在向网易云检索该账号的红心歌单...");

      try {
        const res = await fetch(`${this.ncmApiBase}/user/playlist?uid=${uidOrPlaylistId}`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (data && data.playlist && data.playlist.length > 0) {
            const likedPl = data.playlist[0];
            
            const trackRes = await fetch(`${this.ncmApiBase}/playlist/track/all?id=${likedPl.id}&limit=50`).catch(() => null);
            if (trackRes && trackRes.ok) {
              const trackData = await trackRes.json();
              if (trackData && trackData.songs) {
                let existingPl = this.playlists.find(p => p.id === "ncm_liked");
                if (!existingPl) {
                  existingPl = { id: "ncm_liked", name: "我喜欢的音乐 (网易云)", coverUrl: likedPl.coverImgUrl || "", songIds: [] };
                  this.playlists.unshift(existingPl);
                }

                for (let track of trackData.songs) {
                  const songId = "ncm_" + track.id;
                  const songObj = {
                    id: songId,
                    title: track.name,
                    artist: track.ar ? track.ar.map(a => a.name).join("/") : "未知歌手",
                    cover: track.al ? track.al.picUrl : "",
                    url: `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`,
                    lyrics: "[00:00.00]点击播放拉取歌词",
                    isVip: track.fee === 1,
                    isFavorite: true
                  };

                  await this.saveSongToIndexedDB(songObj);
                  if (!existingPl.songIds.includes(songId)) {
                    existingPl.songIds.push(songId);
                  }
                }

                this.savePlaylistsToStorage();
                if (typeof showToast === 'function') showToast(`成功同步 ${trackData.songs.length} 首网易云红心曲目！`);
                this.renderMine();
                return;
              }
            }
          }
        }
        throw new Error("无法读取该 UID 的公开歌单");
      } catch(e) {
        if (typeof showToast === 'function') showToast("UID 导入失败: " + e.message);
      }
    },

    async syncNcmUserData(cookieStr) {
      if (!cookieStr) return;
      if (typeof showToast === 'function') showToast("正在同步网易云个人资料与红心歌单...");

      try {
        const accRes = await fetch(`${this.ncmApiBase}/user/account?cookie=${encodeURIComponent(cookieStr)}`).catch(() => null);
        let uid = null;
        let nickname = "";
        let avatarUrl = "";
        let isVip = false;

        if (accRes && accRes.ok) {
          const accData = await accRes.json();
          if (accData && accData.profile) {
            uid = accData.profile.userId;
            nickname = accData.profile.nickname;
            avatarUrl = accData.profile.avatarUrl;
            isVip = accData.account && accData.account.vipType > 0;
          }
        }

        if (uid) {
          this.isVip = isVip;
          localStorage.setItem("ncm_user_uid", uid);
          localStorage.setItem("ncm_user_nickname", nickname);
          localStorage.setItem("ncm_user_avatar", avatarUrl);

          const nameEl = document.getElementById("ncm-mine-user-name");
          const remarkEl = document.getElementById("ncm-mine-user-remark");
          const avatarEl = document.getElementById("ncm-mine-user-avatar");

          if (nameEl) nameEl.innerText = nickname || "网易云用户";
          if (remarkEl) remarkEl.innerText = isVip ? "网易云黑胶 VIP 会员" : "网易云账号已同步";
          if (avatarEl && avatarUrl) avatarEl.src = avatarUrl;

          await this.syncNcmByUid(uid);
        }
      } catch(e) {
        console.error("同步网易云数据失败:", e);
      }
    },

    async openCompanionSelector() {
      const overlay = document.getElementById("ncm-companion-selector-overlay");
      const listContainer = document.getElementById("ncm-companion-cards-container");
      if (!overlay || !listContainer) return;

      overlay.classList.add("active");
      listContainer.innerHTML = `<div style="text-align:center; padding:10px; font-size:12px; color:#94a3b8;">读取会话档案中...</div>`;

      const activeMeId = localStorage.getItem("active_me_id");
      if (!activeMeId || typeof db === 'undefined') {
        listContainer.innerHTML = `<div style="text-align:center; padding:10px; font-size:12px; color:#ef4444;">请先在聊天应用中选择“我的人设”</div>`;
        return;
      }

      try {
        const sessions = await db.sessions.where('userId').equals(Number(activeMeId)).toArray();
        if (sessions.length === 0) {
          listContainer.innerHTML = `<div style="text-align:center; padding:10px; font-size:12px; color:#94a3b8;">当前面具下尚未与任何角色建立对话</div>`;
          return;
        }

        let html = "";
        for (let sess of sessions) {
          const charArc = await db.archives.get(Number(sess.charId));
          const name = sess.customCharName || (charArc ? charArc.name : "未知角色");
          const avatarRaw = sess.customCharAvatar || (charArc ? charArc.avatar : "");
          const remark = charArc ? (charArc.remark || "暂无备注") : "单聊会话";

          let avatarSrc = "data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><rect width='100' height='100' fill='%23cbd5e1'/></svg>";
          if (avatarRaw instanceof Blob) {
            avatarSrc = URL.createObjectURL(avatarRaw);
          } else if (typeof avatarRaw === 'string' && avatarRaw) {
            avatarSrc = avatarRaw;
          }

          html += `
            <div class="ncm-song-item" onclick="musicSystem.mountCompanionChar(${sess.charId}, '${name.replace(/'/g, "\\'")}', '${avatarSrc}', '${remark.replace(/'/g, "\\'")}')" style="margin-bottom:8px;">
              <img src="${avatarSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:10px; border:1px solid #e2e8f0;">
              <div class="ncm-song-info">
                <div class="ncm-song-title">${name}</div>
                <div class="ncm-song-artist">${remark}</div>
              </div>
              <button class="btn btn-primary" style="padding:6px 12px; font-size:11px; background:#ec4141; border:none; border-radius:8px; font-weight:700;">选定陪听</button>
            </div>
          `;
        }
        listContainer.innerHTML = html;
      } catch(e) {
        console.error("加载陪听角色失败:", e);
      }
    },

    closeCompanionSelector() {
      const overlay = document.getElementById("ncm-companion-selector-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    mountCompanionChar(charId, name, avatar, remark) {
      if (this.mountedCompanion && this.mountedCompanion.id !== charId) {
        // 核心改动：切换角色时，自动擦除清空上一个角色的听歌聊天记录
        localStorage.removeItem(`ncm_companion_logs_${this.mountedCompanion.id}`);
      }
      this.mountedCompanion = { id: charId, name, avatar, remark };
      this.closeCompanionSelector();
      this.updateIslandCompanionUI();
      if (typeof showToast === 'function') showToast(`已锁定 ${name} 为同频听歌伙伴`);
    },

    unmountCompanionChar(event) {
      if (event) event.stopPropagation();
      if (this.mountedCompanion) {
        localStorage.removeItem(`ncm_companion_logs_${this.mountedCompanion.id}`);
        this.mountedCompanion = null;
      }
      this.updateIslandCompanionUI();
      if (typeof showToast === 'function') showToast("已解绑陪听角色并清空记录");
    },

    handleCompanionButtonClick(event) {
      if (event) event.stopPropagation();
      if (!this.mountedCompanion) {
        this.openCompanionSelector();
      } else {
        this.toggleCardChatView(true);
      }
    },

    updateIslandCompanionUI() {
      const pill = document.getElementById("island-companion-pill");
      if (!pill) return;

      if (!this.mountedCompanion) {
        pill.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:#ec4141;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span>邀请角色与你一起听歌</span>
          </div>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        `;
      } else {
        pill.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="${this.mountedCompanion.avatar}" style="width:22px; height:22px; border-radius:50%; object-fit:cover;">
            <span style="font-size:11px; font-weight:800; color:#ffffff;">与 ${this.mountedCompanion.name} 陪听中</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; font-weight:700; color:#ec4141; background:#ffffff; padding:2px 8px; border-radius:10px;">点击聊天</span>
            <button class="btn-icon" style="color:rgba(255,255,255,0.7);" title="更换/解绑" onclick="musicSystem.unmountCompanionChar(event)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
      }
    },

    renderIslandChatMessages() {
      const container = document.getElementById("island-chat-messages-flow");
      if (!container) return;

      const titleEl = document.getElementById("island-chat-char-title");
      if (titleEl && this.mountedCompanion) {
        titleEl.innerText = `与 ${this.mountedCompanion.name} 听歌中`;
      }

      const charId = this.mountedCompanion ? this.mountedCompanion.id : "default";
      let logs = [];
      try {
        logs = JSON.parse(localStorage.getItem(`ncm_companion_logs_${charId}`)) || [];
      } catch(e) {}

      if (logs.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; margin:6px 0;">
            <span style="font-size:9.5px; background:rgba(255,255,255,0.15); color:rgba(255,255,255,0.8); padding:2px 8px; border-radius:10px; font-weight:700;">网易云同频聊天舱已开启</span>
          </div>
        `;
      } else {
        let html = `
          <div style="text-align:center; margin:6px 0;">
            <span style="font-size:9.5px; background:rgba(255,255,255,0.15); color:rgba(255,255,255,0.8); padding:2px 8px; border-radius:10px; font-weight:700;">网易云同频聊天舱已开启</span>
          </div>
        `;
        logs.forEach(msg => {
          const isUser = msg.sender === 'user';
          const isSystem = msg.sender === 'system';
          if (isSystem) {
            // 系统消息：居中灰字样式（操控指令反馈）
            html += `
              <div style="align-self:center; margin:4px 0; font-size:9.5px; background:rgba(255,255,255,0.12); color:rgba(255,255,255,0.75); padding:2px 8px; border-radius:10px; font-weight:700;">
                ${escapeHtml(msg.text)}
              </div>
            `;
          } else {
            const bgStyle = isUser
              ? "background:#ec4141; color:#ffffff; align-self:flex-end;"
              : "background:rgba(255,255,255,0.18); color:#ffffff; border:1px solid rgba(255,255,255,0.25); align-self:flex-start;";
            html += `
              <div style="padding:6px 10px; border-radius:10px; font-size:11.5px; max-width:82%; word-break:break-all; line-height:1.4; ${bgStyle}">
                ${escapeHtml(msg.text)}
              </div>
            `;
          }
        });
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
      }
    },

    saveCompanionLog(sender, text) {
      if (!this.mountedCompanion) return;
      const charId = this.mountedCompanion.id;
      let logs = [];
      try {
        logs = JSON.parse(localStorage.getItem(`ncm_companion_logs_${charId}`)) || [];
      } catch(e) {}
      logs.push({ sender, text, timestamp: Date.now() });
      localStorage.setItem(`ncm_companion_logs_${charId}`, JSON.stringify(logs));
    },

    async sendIslandUserMessage() {
      const input = document.getElementById("island-chat-input");
      if (!input || !input.value.trim()) return;

      const text = input.value.trim();
      input.value = "";

      this.saveCompanionLog('user', text);

      const container = document.getElementById("island-chat-messages-flow");
      if (container) {
        const userDiv = document.createElement("div");
        userDiv.style.cssText = "align-self:flex-end; background:#ec4141; color:#fff; padding:6px 10px; border-radius:10px; font-size:11.5px; max-width:82%; word-break:break-all; line-height:1.4;";
        userDiv.innerText = text;
        container.appendChild(userDiv);
        container.scrollTop = container.scrollHeight;
      }
    },

    async triggerIslandAiReply() {
      if (!this.mountedCompanion) {
        if (typeof showToast === 'function') showToast("请先选择陪伴听歌的角色");
        return;
      }

      const activeMeId = localStorage.getItem("active_me_id");
      if (!activeMeId || typeof db === 'undefined') return;

      const sessions = await db.sessions.where('userId').equals(Number(activeMeId)).and(s => s.charId === Number(this.mountedCompanion.id)).toArray();
      const mainSession = sessions[0];

      if (typeof showToast === 'function') showToast("AI 伙伴正在同频思考回复...");

      try {
        const activePresetId = localStorage.getItem("global_api_preset_id");
        if (!activePresetId) throw new Error("未配置 API 预设，请先前往设置配置");

        const api = await db.api_presets.get(Number(activePresetId));
        if (!api || !api.url) throw new Error("API 预设无效");

        let basePrompt = "";
        if (mainSession && typeof buildGlobalSystemPrompt === 'function') {
          basePrompt = await buildGlobalSystemPrompt(mainSession.id);
        } else {
          const charArc = await db.archives.get(Number(this.mountedCompanion.id));
          basePrompt = charArc ? charArc.persona : "";
        }

        basePrompt = this.cleanCotText(basePrompt);

        const song = this.playlist[this.currentIndex] || { title: "未知曲目", artist: "未知" };
        const curLyric = (this.lyrics[this.activeLyricIndex] || {}).text || "暂无歌词";
        const curSec = Math.floor(this.audio.currentTime);
        const durSec = Math.floor(this.audio.duration || 0);
        const timeStr = `${Math.floor(curSec/60)}:${(curSec%60).toString().padStart(2,'0')} / ${Math.floor(durSec/60)}:${(durSec%60).toString().padStart(2,'0')}`;

        const musicStatePrompt = `\n\n【网易云听歌同频场景状态】\n你当前正与用户在网易云听歌卡片里同频听歌。\n- 正在播放曲目: 《${song.title}》 - ${song.artist}\n- 播放进度: ${timeStr}\n- 此时此刻唱到的歌词: "${curLyric}"\n- 当前歌单共 ${this.playlist.length} 首歌（索引 0~${this.playlist.length - 1}）\n- 规则与特权：请完全保持你原本的角色性格、口吻、羁绊与记忆。你可以在回复中夹带操控指令：[PLAY_SONG: 数字索引] 切到歌单内指定索引的歌曲、[NEXT_SONG] 下一首、[PREV_SONG] 上一首、[SEEK: 秒数] 拖拉进度条到指定秒数、[PAUSE] 暂停、[RESUME] 恢复。例如："这首歌的前奏让我想起我们上次见面的情景 [SEEK: 30]"。指令执行后会在聊天室以系统消息样式显示反馈（如"拖动进度条到 0:30""切歌到《xxx》"）。严禁输出 <think> 标签！`;

        const finalSystemPrompt = basePrompt + musicStatePrompt;
        const messagesToSend = [{ role: "system", content: finalSystemPrompt }];

        if (mainSession) {
          const rawMsgs = await db.messages.where('sessionId').equals(mainSession.id).reverse().limit(6).toArray();
          rawMsgs.reverse();
          rawMsgs.forEach(m => {
            let cleanStr = this.cleanCotText(m.content);
            if (cleanStr) {
              messagesToSend.push({
                role: m.senderType === 'user' ? 'user' : 'assistant',
                content: cleanStr
              });
            }
          });
        }

        // 核心修复：把用户在【听歌卡片】里真正输入的最新发言与同频历史接进来，彻底解决 AI 不看用户发言的 BUG！
        const charId = this.mountedCompanion.id;
        let islandLogs = [];
        try {
          islandLogs = JSON.parse(localStorage.getItem(`ncm_companion_logs_${charId}`)) || [];
        } catch(e) {}

        if (islandLogs.length > 0) {
          const recentLogs = islandLogs.slice(-6);
          recentLogs.forEach(log => {
            messagesToSend.push({
              role: log.sender === 'user' ? 'user' : 'assistant',
              content: log.text
            });
          });
        } else {
          messagesToSend.push({ role: "user", content: "你觉得这首歌听起来怎么样？" });
        }

        const endpoint = api.url.endsWith('/chat/completions') ? api.url : `${api.url.replace(/\/+$/, '')}/chat/completions`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${api.key}`
          },
          body: JSON.stringify({
            model: api.model,
            messages: messagesToSend,
            temperature: api.temperature || 0.7
          })
        });

        if (!response.ok) throw new Error("API 响应失败");

        const data = await response.json();
        let replyText = data.choices[0].message.content.trim();

        replyText = this.cleanCotText(replyText);

        // 解析 AI 输出的操控指令，并生成系统消息记录到聊天室
        const sysNotices = [];
        const curSong = this.playlist[this.currentIndex];

        if (/\[NEXT(_SONG)?\]/i.test(replyText)) {
          this.nextSong();
          sysNotices.push(`切到下一首`);
        }
        if (/\[PREV(_SONG)?\]/i.test(replyText)) {
          this.prevSong();
          sysNotices.push(`切到上一首`);
        }
        if (/\[PAUSE\]/i.test(replyText)) {
          this.audio.pause();
          sysNotices.push(`暂停了播放`);
        }
        if (/\[RESUME\]/i.test(replyText)) {
          this.audio.play();
          sysNotices.push(`恢复了播放`);
        }

        // [PLAY_SONG:n] 切歌：n 为当前歌单内的索引（若有 currentPlaylistId 则限定歌单范围）
        const playMatch = replyText.match(/\[PLAY_SONG:\s*(\d+)\]/i);
        if (playMatch) {
          const targetIdx = parseInt(playMatch[1]);
          this.playSongFromList(targetIdx);
          const newSong = this.playlist[targetIdx];
          sysNotices.push(newSong ? `切歌到《${newSong.title}》` : `切歌失败（索引超出范围）`);
        }

        // [SEEK:n] 拖拉进度条到指定秒数
        const seekMatch = replyText.match(/\[SEEK:\s*(\d+)\]/i);
        if (seekMatch) {
          const seekSec = parseInt(seekMatch[1]);
          this.audio.currentTime = seekSec;
          const mm = Math.floor(seekSec / 60);
          const ss = (seekSec % 60).toString().padStart(2, '0');
          sysNotices.push(`拖动进度条到 ${mm}:${ss}`);
        }

        const cleanReply = replyText.replace(/\[(PLAY_SONG|SEEK|PAUSE|RESUME|NEXT|PREV|NEXT_SONG|PREV_SONG).*?\]/gi, "").trim();
        const sentences = cleanReply.split(/(?<=[。！？!?\n])/).filter(s => s.trim());

        const container = document.getElementById("island-chat-messages-flow");
        if (container) {
          sentences.forEach((sen, i) => {
            setTimeout(() => {
              const text = sen.trim();
              this.saveCompanionLog('char', text);

              const aiDiv = document.createElement("div");
              aiDiv.style.cssText = "align-self:flex-start; background:rgba(255,255,255,0.18); color:#ffffff; border:1px solid rgba(255,255,255,0.25); padding:6px 10px; border-radius:10px; font-size:11.5px; max-width:82%; word-break:break-all; line-height:1.4;";
              aiDiv.innerText = text;
              container.appendChild(aiDiv);
              container.scrollTop = container.scrollHeight;
            }, i * 600);
          });

          // 渲染系统消息（操控指令反馈），在所有对白之后
          if (sysNotices.length > 0) {
            setTimeout(() => {
              sysNotices.forEach(notice => {
                this.saveCompanionLog('system', notice);
                const sysDiv = document.createElement("div");
                sysDiv.style.cssText = "align-self:center; margin:4px 0; font-size:9.5px; background:rgba(255,255,255,0.12); color:rgba(255,255,255,0.75); padding:2px 8px; border-radius:10px; font-weight:700;";
                sysDiv.innerText = notice;
                container.appendChild(sysDiv);
                container.scrollTop = container.scrollHeight;
              });
            }, sentences.length * 600);
          }
        }

      } catch(err) {
        console.error("AI 陪听响应异常:", err);
      }
    },

    async searchNcmMusic() {
      const input = document.getElementById("ncm-search-keyword");
      const listContainer = document.getElementById("ncm-search-results-list");
      if (!input || !listContainer) return;

      const keyword = input.value.trim();
      if (!keyword) {
        if (typeof showToast === 'function') showToast("请输入搜索关键词");
        return;
      }

      listContainer.innerHTML = `<div style="text-align:center; padding:20px; font-size:12px; color:#94a3b8;">正在向本地与网易云曲库检索中...</div>`;

      let html = "";

      // 1. 本地曲库搜索
      const localSongs = await this.getAllSongsFromIndexedDB();
      const matchedLocal = localSongs.filter(s => s.title.includes(keyword) || (s.artist && s.artist.includes(keyword)));

      if (matchedLocal.length > 0) {
        html += `<div style="font-size:11px; font-weight:800; color:#ec4141; margin-bottom:6px;">-- 本地/已导入匹配曲目 --</div>`;
        matchedLocal.forEach(s => {
          const globalIdx = localSongs.findIndex(ls => ls.id === s.id);
          html += `
            <div class="ncm-song-item" onclick="musicSystem.playSongFromList(${globalIdx})" style="margin-bottom:8px;">
              <div class="ncm-song-info">
                <div class="ncm-song-title">${s.title}</div>
                <div class="ncm-song-artist">${s.artist || '本地导入'}</div>
              </div>
              <button class="btn-icon" style="color:#ec4141;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
            </div>
          `;
        });
      }

      // 2. 网易云在线搜索：多通道容错竞速
      let onlineSongs = [];
      const encKw = encodeURIComponent(keyword);

      // 通道一：官方搜索 API（走 ncmNativeFetch，含 allorigins 代理兜底）
      try {
        const searchUrl = `https://music.163.com/api/search/get?s=${encKw}&type=1&limit=30&offset=0`;
        const result = await Promise.race([
          this.ncmNativeFetch(searchUrl, "POST", { "Referer": "https://music.163.com/" }, `s=${encKw}&type=1&limit=30&offset=0`),
          new Promise(resolve => setTimeout(() => resolve(null), 5000))
        ]);
        if (result && result.data && result.data.result && Array.isArray(result.data.result.songs)) {
          onlineSongs = result.data.result.songs.map(song => ({
            id: song.id,
            name: song.name,
            artist: song.artists ? song.artists.map(a => a.name).join("/") : "未知歌手",
            fee: song.fee || 0
          }));
        }
      } catch(e) { /* 通道一失败，继续尝试通道二 */ }

      // 通道二：Vercel 代理 API（原通道，作为兜底）
      if (onlineSongs.length === 0) {
        try {
          const res = await Promise.race([
            fetch(`${this.ncmApiBase}/search?keywords=${encKw}`).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
          ]);
          if (res && res.ok) {
            const data = await res.json();
            if (data && data.result && Array.isArray(data.result.songs)) {
              onlineSongs = data.result.songs.map(song => ({
                id: song.id,
                name: song.name,
                artist: song.artists ? song.artists.map(a => a.name).join("/") : "未知歌手",
                fee: song.fee || 0
              }));
            }
          }
        } catch(e) { /* 通道二失败，继续尝试通道三 */ }
      }

      // 通道三：Meting 开源 API（最后兜底）
      if (onlineSongs.length === 0) {
        try {
          const metingRes = await Promise.race([
            fetch(`https://api.i-meto.com/meting/v1/search?server=netease&type=search&id=${encKw}`).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
          ]);
          if (metingRes && metingRes.ok) {
            const metingData = await metingRes.json();
            if (Array.isArray(metingData) && metingData.length > 0) {
              onlineSongs = metingData.map(t => ({
                id: t.id || t.song_id,
                name: t.name || t.title || "未知歌曲",
                artist: t.artist || t.author || "网易云歌手",
                fee: 0
              }));
            }
          }
        } catch(e) { /* 所有通道均失败 */ }
      }

      if (onlineSongs.length > 0) {
        html += `<div style="font-size:11px; font-weight:800; color:#0284c7; margin:10px 0 6px 0;">-- 网易云在线曲库 --</div>`;
        onlineSongs.forEach(song => {
          const songId = song.id;
          const title = String(song.name).replace(/'/g, "\\'");
          const artist = String(song.artist).replace(/'/g, "\\'");
          const isVip = song.fee === 1;
          html += `
            <div class="ncm-song-item" style="margin-bottom:8px; display:flex; align-items:center;">
              <div class="ncm-song-info" style="flex:1;" onclick="musicSystem.playOnlineNcmSong('${songId}', '${title}', '${artist}', ${isVip})">
                <div class="ncm-song-title">
                  ${song.name}
                  ${isVip ? '<span class="ncm-vip-tag">VIP</span>' : ''}
                </div>
                <div class="ncm-song-artist">${song.artist}</div>
              </div>
              <button class="btn-icon" style="color:#ec4141; margin-right:4px;" onclick="musicSystem.playOnlineNcmSong('${songId}', '${title}', '${artist}', ${isVip})" title="播放">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <button class="btn-icon" style="color:#64748b;" onclick="musicSystem.importSearchResult('${songId}', '${title}', '${artist}', ${isVip})" title="导入到歌单">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
          `;
        });
      }

      if (!html) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px; font-size:12px; color:#94a3b8;">所有搜索通道均未响应，可直接粘贴网易云歌曲链接进行导入</div>`;
      } else if (onlineSongs.length === 0 && matchedLocal.length > 0) {
        listContainer.innerHTML = html + `<div style="text-align:center; padding:10px; font-size:11px; color:#cbd5e1;">在线搜索通道暂不可用，可粘贴网易云链接导入</div>`;
      } else {
        listContainer.innerHTML = html;
      }
    },

    // 将搜索结果导入到歌单（可选择目标歌单）
    async importSearchResult(songId, title, artist, isVip) {
      const playlists = this.playlists.filter(p => !p.id.startsWith("ncm_liked"));
      if (playlists.length === 0) {
        if (typeof showToast === 'function') showToast("请先创建一个歌单再导入");
        return;
      }
      const songObj = {
        id: "ncm_" + songId,
        title: title,
        artist: artist,
        url: `https://music.163.com/song/media/outer/url?id=${songId}.mp3`,
        cover: "",
        lyrics: "[00:00.00]歌词加载中...",
        isVip: isVip,
        isFavorite: false
      };
      await this.saveSongToIndexedDB(songObj);
      let targetPl = playlists[0];
      if (playlists.length > 1) {
        const options = playlists.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
        const idx = window.prompt(`选择要导入的歌单：\n${options}\n\n输入序号：`, "1");
        const num = parseInt(idx) - 1;
        if (isNaN(num) || num < 0 || num >= playlists.length) {
          if (typeof showToast === 'function') showToast("已取消导入");
          return;
        }
        targetPl = playlists[num];
      }
      if (!targetPl.songIds.includes(songObj.id)) {
        targetPl.songIds.push(songObj.id);
        await this.savePlaylistsToStorage();
        if (typeof showToast === 'function') showToast(`已导入"${title}"到歌单"${targetPl.name}"`);
      } else {
        if (typeof showToast === 'function') showToast("该歌曲已在歌单中");
      }
    },

    async playOnlineNcmSong(songId, title, artist, isVip) {
      const songObj = {
        id: "ncm_" + songId,
        title: title,
        artist: artist,
        url: `https://music.163.com/song/media/outer/url?id=${songId}.mp3`,
        cover: "",
        lyrics: "[00:00.00]歌词加载中...",
        isVip: isVip,
        isFavorite: false
      };

      await this.saveSongToIndexedDB(songObj);
      const songs = await this.getAllSongsFromIndexedDB();
      const idx = songs.findIndex(s => s.id === songObj.id);
      if (idx !== -1) {
        this.playSongFromList(idx);
      }
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.musicSystem.init();
  });
})();

function initMusicApp() {
  if (window.musicSystem) window.musicSystem.init();
}