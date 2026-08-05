/**
 * app_desktop_presets.js - 系统内置桌面 UI 预设主题库
 * 包含：清透凉夏 (Ins 拟物风) images 文件夹 .jpg 本地路径适配版
 */

window.DESKTOP_PRESETS = {
  clear_cool_summer: {
    name: "清透凉夏 (Ins拟物风)",
    confirmText: "确定要应用【清透凉夏】UI预设吗？这将会更新您的桌面布局、背景壁纸与全局注入样式。",
    wallpaper: "./images/wallpaper_summer.jpg",
    dockOpacity: "35",
    activeCss: `@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap');

/* 清透凉夏 - 桌面微调 */
#desktop {
  padding: 16px 14px 14px 14px !important;
}

/* 彻底擦除图标外壳边框与背景，显示纯悬浮 SVG 图标 */
.app-icon .icon-wrapper {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  margin-bottom: 2px !important;
}

.app-icon:active .icon-wrapper {
  transform: scale(0.88) !important;
}

/* 莫兰迪低纯度柔和浅色调系 */
.app-icon .icon-wrapper svg {
  width: 38px !important;
  height: 38px !important;
  filter: drop-shadow(0 3px 8px rgba(15, 23, 42, 0.1)) drop-shadow(0 1px 2px rgba(255, 255, 255, 0.9)) !important;
  mix-blend-mode: normal !important;
  opacity: 1 !important;
  transition: transform 0.2s ease !important;
}

.app-icon[data-app="chat"] .icon-wrapper svg { color: #38bdf8 !important; }       /* 浅冰蓝 */
.app-icon[data-app="forum"] .icon-wrapper svg { color: #34d399 !important; }      /* 柔薄荷 */
.app-icon[data-app="deeptalk"] .icon-wrapper svg { color: #c084fc !important; }   /* 淡紫罗兰 */
.app-icon[data-app="couples"] .icon-wrapper svg { color: #fb7185 !important; }    /* 浅甜莓 */
.app-icon[data-app="reader"] .icon-wrapper svg { color: #fbbf24 !important; }     /* 柔暖琥珀 */
.app-icon[data-app="archive"] .icon-wrapper svg { color: #60a5fa !important; }    /* 浅天蓝 */
.app-icon[data-app="world_book"] .icon-wrapper svg { color: #2dd4bf !important; }/* 浅青绿 */
.app-icon[data-app="music"] .icon-wrapper svg { color: #f472b6 !important; }      /* 樱花粉 */
.app-icon[data-app="shopping"] .icon-wrapper svg { color: #ff6b35 !important; }  /* 淘宝橙 */
.app-icon[data-app="encounter"] .icon-wrapper svg { color: #a78bfa !important; } /* 邂逅紫 */
.app-icon[data-app="settings"] .icon-wrapper svg { color: #64748b !important; }  /* 烟灰钛 */

.app-icon span {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: #334155 !important;
  letter-spacing: 0.3px !important;
  text-shadow: 0 1px 3px rgba(255, 255, 255, 0.9) !important;
}

/* Dock 栏：水晶玻璃卡片 */
.dock-container {
  background-color: rgba(255, 255, 255, 0.38) !important;
  backdrop-filter: blur(25px) saturate(200%) !important;
  -webkit-backdrop-filter: blur(25px) saturate(200%) !important;
  border-radius: 32px !important;
  border: 1.5px solid rgba(255, 255, 255, 0.75) !important;
  box-shadow: 0 12px 32px rgba(148, 163, 184, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.9) !important;
}`,
    widgets: {
      // 1. 第一页顶层 4x3：等长错落 5 竖条 + 花体字时钟 (预置 ./images/widget_top_photo.jpg)
      widget_clear_summer_top: {
        id: "widget_clear_summer_top",
        name: "清透凉夏·花体时钟与等长错落拼图",
        widthSpan: 4,
        heightSpan: 3,
        html: `<div id="cs-top-widget" style="width:100%; height:100%; box-sizing:border-box; padding:2px; background:transparent !important; border:none !important; box-shadow:none !important; display:flex; flex-direction:column; justify-content:space-between; user-select:none; font-family:-apple-system,BlinkMacSystemFont,sans-serif; overflow:visible !important;">
  <!-- 左上角花体艺术字时钟 -->
  <div style="display:flex; justify-content:flex-start; align-items:flex-end; padding-left:2px; height:32px;">
    <div id="cs-top-time" contenteditable="true" style="font-family:'Dancing Script', cursive, sans-serif; font-size:40px; font-weight:700; line-height:0.9; color:#334155; text-shadow:0 2px 8px rgba(255,255,255,0.9); outline:none; cursor:text;">12:00</div>
  </div>

  <!-- 5 个等长纵向错落竖条 -->
  <div id="cs-stagger-container" onclick="document.getElementById('cs-top-file-input').click()" style="width:100%; height:calc(100% - 38px); display:flex; gap:6px; align-items:center; cursor:pointer; margin-top:6px; overflow:visible;" title="点击上传照片">
    <input type="file" id="cs-top-file-input" accept="image/*" style="display:none;">
    <div class="cs-v-bar" style="flex:1; height:100%; transform:translateY(-5px); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,0.88); box-shadow:0 6px 14px rgba(15,23,42,0.06); background-image:url('./images/widget_top_photo.jpg'); background-size:500% 100%; background-position:0% 50%;"></div>
    <div class="cs-v-bar" style="flex:1; height:100%; transform:translateY(6px); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,0.88); box-shadow:0 6px 14px rgba(15,23,42,0.06); background-image:url('./images/widget_top_photo.jpg'); background-size:500% 100%; background-position:25% 50%;"></div>
    <div class="cs-v-bar" style="flex:1; height:100%; transform:translateY(-2px); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,0.88); box-shadow:0 6px 14px rgba(15,23,42,0.06); background-image:url('./images/widget_top_photo.jpg'); background-size:500% 100%; background-position:50% 50%;"></div>
    <div class="cs-v-bar" style="flex:1; height:100%; transform:translateY(7px); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,0.88); box-shadow:0 6px 14px rgba(15,23,42,0.06); background-image:url('./images/widget_top_photo.jpg'); background-size:500% 100%; background-position:75% 50%;"></div>
    <div class="cs-v-bar" style="flex:1; height:100%; transform:translateY(-4px); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,0.88); box-shadow:0 6px 14px rgba(15,23,42,0.06); background-image:url('./images/widget_top_photo.jpg'); background-size:500% 100%; background-position:100% 50%;"></div>
  </div>
</div>
<script>
(function() {
  const container = document.getElementById("cs-top-widget");
  if (!container) return;

  const savedImg = localStorage.getItem("cs_store_top_img") || "./images/widget_top_photo.jpg";
  const bars = container.querySelectorAll(".cs-v-bar");
  bars.forEach(bar => { bar.style.backgroundImage = "url('" + savedImg + "')"; });

  const savedTime = localStorage.getItem("cs_store_top_time");
  const timeEl = document.getElementById("cs-top-time");
  if (savedTime && timeEl) timeEl.innerText = savedTime;

  function updateTime() {
    if (!timeEl || timeEl === document.activeElement) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    timeEl.innerText = hh + ":" + mm;
  }
  updateTime();
  const timer = setInterval(updateTime, 10000);

  if (timeEl) {
    timeEl.onblur = function() {
      localStorage.setItem("cs_store_top_time", timeEl.innerText.trim());
    };
  }

  function processSquareImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      const img = new Image();
      img.onload = function() {
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 600, 600);
        callback(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  const fileInput = document.getElementById("cs-top-file-input");
  if (fileInput) {
    fileInput.onchange = function(e) {
      if (e.target.files && e.target.files[0]) {
        processSquareImage(e.target.files[0], function(croppedUrl) {
          bars.forEach(bar => { bar.style.backgroundImage = "url('" + croppedUrl + "')"; });
          localStorage.setItem("cs_store_top_img", croppedUrl);
        });
      }
    };
  }

  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      clearInterval(timer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
</script>`
      },

      // 2. 第一页左下角 2x2：拍立得组件 (预置 ./images/widget_polaroid_photo.jpg)
      widget_clear_summer_polaroid: {
        id: "widget_clear_summer_polaroid",
        name: "清透凉夏·拍立得组件",
        widthSpan: 2,
        heightSpan: 2,
        html: `<div id="cs-polaroid-widget" style="width:100%; height:100%; box-sizing:border-box; padding:8px 8px 10px 8px; border-radius:18px; background:rgba(255,255,255,0.75); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1.5px solid rgba(255,255,255,0.9); box-shadow:0 10px 25px rgba(0,0,0,0.06); display:flex; flex-direction:column; align-items:center; transform:rotate(-1deg); user-select:none; font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <input type="file" id="cs-pol-file-input" accept="image/*" style="display:none;">
  <div id="cs-pol-photo" onclick="document.getElementById('cs-pol-file-input').click()" style="width:100%; flex:1; border-radius:12px; overflow:hidden; background:#f0f9ff; background-image:url('./images/widget_polaroid_photo.jpg'); background-size:cover; background-position:center; cursor:pointer; border:1px solid rgba(0,0,0,0.04);"></div>
  <div id="cs-pol-caption" contenteditable="true" style="margin-top:6px; font-family:'Dancing Script', cursive, sans-serif; font-size:13px; font-weight:700; color:#334155; text-align:center; outline:none; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:text;">Summer Memory</div>
</div>
<script>
(function() {
  const container = document.getElementById("cs-polaroid-widget");
  if (!container) return;

  const savedImg = localStorage.getItem("cs_store_pol_img") || "./images/widget_polaroid_photo.jpg";
  const photoDiv = document.getElementById("cs-pol-photo");
  if (photoDiv) photoDiv.style.backgroundImage = "url('" + savedImg + "')";
  
  const savedCap = localStorage.getItem("cs_store_pol_cap");
  const capEl = document.getElementById("cs-pol-caption");
  if (savedCap && capEl) capEl.innerText = savedCap;

  if (capEl) {
    capEl.onblur = function() {
      localStorage.setItem("cs_store_pol_cap", capEl.innerText.trim());
    };
  }

  const fileInput = document.getElementById("cs-pol-file-input");
  if (fileInput && photoDiv) {
    fileInput.onchange = function(e) {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = function(evt) {
          const img = new Image();
          img.onload = function() {
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            const canvas = document.createElement("canvas");
            canvas.width = 500;
            canvas.height = 500;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, size, size, 0, 0, 500, 500);
            const cropped = canvas.toDataURL("image/jpeg", 0.88);
            photoDiv.style.backgroundImage = "url('" + cropped + "')";
            localStorage.setItem("cs_store_pol_img", cropped);
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    };
  }
})();
</script>`
      },

      // 3. 第二页第 1-3 排 4x3：iOS 短信伪对话组件 (预置 ./images/avatar_char1.jpg 与 ./images/avatar_char2.jpg)
      widget_clear_summer_dialogue: {
        id: "widget_clear_summer_dialogue",
        name: "清透凉夏·iOS短信风伪对话组件",
        widthSpan: 4,
        heightSpan: 3,
        html: `<div id="cs-dialogue-widget" style="width:100%; height:100%; box-sizing:border-box; padding:2px 4px; background:transparent !important; border:none !important; box-shadow:none !important; display:flex; flex-direction:column; justify-content:space-between; user-select:none; font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <input type="file" id="cs-dlg-file-1" accept="image/*" style="display:none;">
  <input type="file" id="cs-dlg-file-2" accept="image/*" style="display:none;">
  
  <!-- 上半部分：头像 1 + 3 行长短错落左对齐 iOS 磨砂气泡 -->
  <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%;">
    <div id="cs-dlg-avatar-1" onclick="document.getElementById('cs-dlg-file-1').click()" style="width:48px; height:48px; border-radius:50%; background:#bae6fd; background-image:url('./images/avatar_char1.jpg'); background-size:cover; border:3px solid rgba(255,255,255,0.88); backdrop-filter:blur(10px); box-shadow:0 6px 16px rgba(15,23,42,0.1); flex-shrink:0; cursor:pointer; margin-left:2px; margin-bottom:2px;" title="点击换头像"></div>
    
    <div id="cs-dlg-t1-1" contenteditable="true" style="padding:7px 13px; border-radius:18px; background:rgba(255,255,255,0.72); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1.5px solid rgba(255,255,255,0.92); box-shadow:0 4px 14px rgba(15,23,42,0.06); font-size:12px; font-weight:600; color:#1e293b; outline:none; cursor:text; max-width:72%; text-align:left;">
      "今天的天空像冰汽水一样。"
    </div>
    <div id="cs-dlg-t1-2" contenteditable="true" style="padding:7px 13px; border-radius:18px; background:rgba(255,255,255,0.72); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1.5px solid rgba(255,255,255,0.92); box-shadow:0 4px 14px rgba(15,23,42,0.06); font-size:12px; font-weight:600; color:#1e293b; outline:none; cursor:text; max-width:88%; text-align:left;">
      "想和你去风平浪静的海滩走走。"
    </div>
    <div id="cs-dlg-t1-3" contenteditable="true" style="padding:7px 13px; border-radius:18px; background:rgba(255,255,255,0.72); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1.5px solid rgba(255,255,255,0.92); box-shadow:0 4px 14px rgba(15,23,42,0.06); font-size:12px; font-weight:600; color:#1e293b; outline:none; cursor:text; max-width:55%; text-align:left;">
      "记得带上相机。"
    </div>
  </div>

  <!-- 下半部分：2 行长短错落右对齐 iOS 磨砂气泡 + 头像 2 -->
  <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; width:100%; margin-top:4px;">
    <div id="cs-dlg-t2-1" contenteditable="true" style="padding:7px 13px; border-radius:18px; background:rgba(224,242,254,0.82); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1.5px solid rgba(255,255,255,0.92); box-shadow:0 4px 14px rgba(15,23,42,0.06); font-size:12px; font-weight:600; color:#0369a1; outline:none; cursor:text; max-width:68%; text-align:right;">
      "好啊，那晚饭后就出发。"
    </div>
    <div id="cs-dlg-t2-2" contenteditable="true" style="padding:7px 13px; border-radius:18px; background:rgba(224,242,254,0.82); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1.5px solid rgba(255,255,255,0.92); box-shadow:0 4px 14px rgba(15,23,42,0.06); font-size:12px; font-weight:600; color:#0369a1; outline:none; cursor:text; max-width:85%; text-align:right;">
      "刚好可以赶上看落日余晖。"
    </div>

    <div id="cs-dlg-avatar-2" onclick="document.getElementById('cs-dlg-file-2').click()" style="width:48px; height:48px; border-radius:50%; background:#fef08a; background-image:url('./images/avatar_char2.jpg'); background-size:cover; border:3px solid rgba(255,255,255,0.88); backdrop-filter:blur(10px); box-shadow:0 6px 16px rgba(15,23,42,0.1); flex-shrink:0; cursor:pointer; margin-right:2px; margin-top:2px;" title="点击换头像"></div>
  </div>
</div>
<script>
(function() {
  const container = document.getElementById("cs-dialogue-widget");
  if (!container) return;

  const avt1 = document.getElementById("cs-dlg-avatar-1");
  const avt2 = document.getElementById("cs-dlg-avatar-2");
  
  const t1_1 = document.getElementById("cs-dlg-t1-1");
  const t1_2 = document.getElementById("cs-dlg-t1-2");
  const t1_3 = document.getElementById("cs-dlg-t1-3");
  
  const t2_1 = document.getElementById("cs-dlg-t2-1");
  const t2_2 = document.getElementById("cs-dlg-t2-2");

  const sAvt1 = localStorage.getItem("cs_store_dlg_avt1") || "./images/avatar_char1.jpg";
  if (avt1) avt1.style.backgroundImage = "url('" + sAvt1 + "')";
  
  const sAvt2 = localStorage.getItem("cs_store_dlg_avt2") || "./images/avatar_char2.jpg";
  if (avt2) avt2.style.backgroundImage = "url('" + sAvt2 + "')";

  const sT1_1 = localStorage.getItem("cs_store_dlg_t1_1"); if (sT1_1 && t1_1) t1_1.innerText = sT1_1;
  const sT1_2 = localStorage.getItem("cs_store_dlg_t1_2"); if (sT1_2 && t1_2) t1_2.innerText = sT1_2;
  const sT1_3 = localStorage.getItem("cs_store_dlg_t1_3"); if (sT1_3 && t1_3) t1_3.innerText = sT1_3;

  const sT2_1 = localStorage.getItem("cs_store_dlg_t2_1"); if (sT2_1 && t2_1) t2_1.innerText = sT2_1;
  const sT2_2 = localStorage.getItem("cs_store_dlg_t2_2"); if (sT2_2 && t2_2) t2_2.innerText = sT2_2;

  if (t1_1) t1_1.onblur = function() { localStorage.setItem("cs_store_dlg_t1_1", t1_1.innerText.trim()); };
  if (t1_2) t1_2.onblur = function() { localStorage.setItem("cs_store_dlg_t1_2", t1_2.innerText.trim()); };
  if (t1_3) t1_3.onblur = function() { localStorage.setItem("cs_store_dlg_t1_3", t1_3.innerText.trim()); };

  if (t2_1) t2_1.onblur = function() { localStorage.setItem("cs_store_dlg_t2_1", t2_1.innerText.trim()); };
  if (t2_2) t2_2.onblur = function() { localStorage.setItem("cs_store_dlg_t2_2", t2_2.innerText.trim()); };

  function bindSquareFile(fileId, avatarId, storeKey) {
    const fileEl = document.getElementById(fileId);
    const avtEl = document.getElementById(avatarId);
    if (fileEl && avtEl) {
      fileEl.onchange = function(e) {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            const img = new Image();
            img.onload = function() {
              const size = Math.min(img.width, img.height);
              const sx = (img.width - size) / 2;
              const sy = (img.height - size) / 2;
              const canvas = document.createElement("canvas");
              canvas.width = 300;
              canvas.height = 300;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, sx, sy, size, size, 0, 0, 300, 300);
              const cropped = canvas.toDataURL("image/jpeg", 0.88);
              avtEl.style.backgroundImage = "url('" + cropped + "')";
              localStorage.setItem(storeKey, cropped);
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      };
    }
  }
  bindSquareFile("cs-dlg-file-1", "cs-dlg-avatar-1", "cs_store_dlg_avt1");
  bindSquareFile("cs-dlg-file-2", "cs-dlg-avatar-2", "cs_store_dlg_avt2");
})();
</script>`
      },

      // 4. 第二页第 5 排 4x1：无背景悬空细长播放进度条组件 (纯 SVG，无文字 Emoji)
      widget_clear_summer_music: {
        id: "widget_clear_summer_music",
        name: "清透凉夏·悬空音乐播放器",
        widthSpan: 4,
        heightSpan: 1,
        html: `<div id="cs-music-widget" style="width:100%; height:100%; box-sizing:border-box; padding:0 8px; background:transparent !important; border:none !important; box-shadow:none !important; display:flex; flex-direction:column; justify-content:center; gap:8px; user-select:none;">
  <!-- 细长进度条 -->
  <div style="width:100%; height:4px; background:rgba(255,255,255,0.45); border-radius:2px; position:relative; cursor:pointer;" onclick="var p=event.offsetX/this.clientWidth*100; document.getElementById('cs-m-progress').style.width=p+'%'; localStorage.setItem('cs_store_m_prog', p);">
    <div id="cs-m-progress" style="width:42%; height:100%; background:#38bdf8; border-radius:2px; position:relative; box-shadow:0 0 8px rgba(56,189,248,0.5);">
      <div style="position:absolute; right:-4px; top:-3px; width:10px; height:10px; border-radius:50%; background:#ffffff; box-shadow:0 2px 6px rgba(0,0,0,0.18);"></div>
    </div>
  </div>

  <!-- 控制按键行 (和谐冰蓝与哑光灰钛色，纯 SVG) -->
  <div style="display:flex; justify-content:space-around; align-items:center; padding:0 12px;">
    <!-- 循环模式 -->
    <div id="cs-m-mode" onclick="this.classList.toggle('active');" style="color:#64748b; cursor:pointer;" title="播放模式">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 2px 4px rgba(255,255,255,0.8));"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
    </div>
    <!-- 上一曲 -->
    <div onclick="var p=document.getElementById('cs-m-progress'); p.style.width='0%';" style="color:#334155; cursor:pointer;" title="上一曲">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="filter:drop-shadow(0 2px 4px rgba(255,255,255,0.8));"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
    </div>
    <!-- 播放/暂停 -->
    <div id="cs-m-playbtn" onclick="var svg=this.querySelector('svg'); if(this.dataset.playing==='1'){this.dataset.playing='0'; svg.innerHTML='<path d=\\'M8 5v14l11-7z\\'/>';}else{this.dataset.playing='1'; svg.innerHTML='<path d=\\'M6 19h4V5H6v14zm8-14v14h4V5h-4z\\'/>';}" data-playing="0" style="color:#38bdf8; cursor:pointer;" title="播放/暂停">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" style="filter:drop-shadow(0 2px 6px rgba(56,189,248,0.3));"><path d="M8 5v14l11-7z"/></svg>
    </div>
    <!-- 下一曲 -->
    <div onclick="var p=document.getElementById('cs-m-progress'); p.style.width='75%';" style="color:#334155; cursor:pointer;" title="下一曲">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="filter:drop-shadow(0 2px 4px rgba(255,255,255,0.8));"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
    </div>
    <!-- 红心收藏 -->
    <div id="cs-m-heart" onclick="var path=this.querySelector('path'); if(this.dataset.liked==='1'){this.dataset.liked='0'; this.style.color='#64748b'; path.setAttribute('fill','none'); localStorage.setItem('cs_store_m_liked','0');}else{this.dataset.liked='1'; this.style.color='#fb7185'; path.setAttribute('fill','currentColor'); localStorage.setItem('cs_store_m_liked','1');}" data-liked="0" style="color:#64748b; cursor:pointer;" title="收藏">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 2px 4px rgba(255,255,255,0.8));"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </div>
  </div>
</div>
<script>
(function() {
  const container = document.getElementById("cs-music-widget");
  if (!container) return;
  const sProg = localStorage.getItem("cs_store_m_prog");
  const pBar = document.getElementById("cs-m-progress");
  if (sProg && pBar) pBar.style.width = sProg + "%";

  const sLiked = localStorage.getItem("cs_store_m_liked");
  const heart = document.getElementById("cs-m-heart");
  if (sLiked === "1" && heart) {
    heart.dataset.liked = "1";
    heart.style.color = "#fb7185";
    const path = heart.querySelector("path");
    if (path) path.setAttribute("fill", "currentColor");
  }
})();
</script>`
      }
    },

    // 绑定小部件落地槽位
    placedDesktop: {
      "0": "widget_clear_summer_top",
      "12": "widget_clear_summer_polaroid",
      "20": "widget_clear_summer_dialogue",
      "36": "widget_clear_summer_music"
    },

    // 桌面两页网格排版映射
    // 规则：chat / world_book / archive 只放 dock 栏，不占主页面格子
    // 注意 widget 物理覆盖范围（cols=4）：
    //   widget_clear_summer_top: 4x3 在槽位0，覆盖 0-11
    //   widget_clear_summer_polaroid: 2x2 在槽位12，覆盖 12,13,16,17
    //   因此第一页可用 app 槽位为：14,15,18,19
    //   widget_clear_summer_dialogue: 4x3 在槽位20，覆盖 20-31
    //   widget_clear_summer_music: 4x1 在槽位36，覆盖 36-39
    //   因此第二页可用 app 槽位为：32-35（第5排被播放器组件占用）
    desktopLayout: [
      // === 第一页 (0~19) === 槽位 14,15,18,19 可用
      null, null, null, null,
      null, null, null, null,
      null, null, null, null,
      null, null, "encounter", "deeptalk",
      null, null, "reader", "forum",

      // === 第二页 (20~39) === 槽位 32-35 可用（36-39 被播放器组件占用）
      null, null, null, null,
      null, null, null, null,
      null, null, null, null,
      "couples", "music", "shopping", "quicktravel",
      null, null, null, null
    ],

    // 底部 Dock 栏排布
    dockLayout: ["settings", "chat", "archive", "world_book"]
  }
};

window.applyBuiltinThemePreset = function(specifiedKey) {
  const select = document.getElementById("beautify-builtin-preset-select");
  const key = specifiedKey || (select ? select.value : "");
  if (!key) {
    if (typeof showToast === "function") showToast("请先选择一个系统内置 UI 预设");
    return;
  }

  const preset = window.DESKTOP_PRESETS[key];
  if (!preset) {
    if (typeof showToast === "function") showToast("未找到对应的预设配置");
    return;
  }

  const executeApply = () => {
    // 1. 设置背景与 Dock 不透明度
    if (preset.wallpaper) {
      localStorage.setItem("beautify-wallpaper", preset.wallpaper);
    }
    if (preset.dockOpacity) {
      localStorage.setItem("beautify-dock-opacity", preset.dockOpacity);
    }

    // 2. 设置全局 CSS
    if (preset.activeCss) {
      localStorage.setItem("beautify-active-css", preset.activeCss);
    }

    // 3. 写入内置小部件库
    if (preset.widgets) {
      let existingWidgets = {};
      try { existingWidgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {}; } catch(e) {}
      Object.assign(existingWidgets, preset.widgets);
      localStorage.setItem("beautify-widgets", JSON.stringify(existingWidgets));
    }

    // 4. 设置桌面摆放小部件
    if (preset.placedDesktop) {
      localStorage.setItem("placed-widgets-desktop", JSON.stringify(preset.placedDesktop));
    }

    // 5. 设置桌面与 Dock 排版
    if (preset.desktopLayout) {
      localStorage.setItem("desktop-layout-v3", JSON.stringify(preset.desktopLayout));
    }
    if (preset.dockLayout) {
      localStorage.setItem("dock-layout-v3", JSON.stringify(preset.dockLayout));
    }

    if (typeof showToast === "function") {
      showToast(`已成功应用预设: ${preset.name}`);
    }

    // 6. 立即触发全局重绘
    if (typeof window.applyGlobalSettingsOnLoad === "function") window.applyGlobalSettingsOnLoad();
    if (typeof window.loadDesktopLayout === "function") window.loadDesktopLayout();
    if (typeof window.loadBeautifyForm === "function") window.loadBeautifyForm();
  };

  // 使用系统自研卡片 Confirm，彻底弃用原生 confirm 弹窗
  if (typeof showCustomConfirm === "function") {
    showCustomConfirm("应用UI主题预设", preset.confirmText || `确定要应用【${preset.name}】UI预设吗？`, executeApply);
  } else {
    executeApply();
  }
};