/**
 * app_desktop_presets.js - 系统内置桌面 UI 预设主题库
 * 包含：清透凉夏 (Ins 拟物风) images 文件夹 .jpg 本地路径适配版
 */

window.DESKTOP_PRESETS = {
  clear_cool_summer: {
    name: "清透凉夏 (Ins拟物风)",
    confirmText: "确定要应用【清透凉夏】UI预设吗？这将会更新您的桌面布局、背景壁纸与全局注入样式。",
    rows: 5,            // 这个预设是按 4 列 × 5 行（每页 20 格）设计的，不能改成 7 行
    pageSize: 20,
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
.app-icon[data-app="workbench"] .icon-wrapper svg { color: #22d3ee !important; } /* 工作台青 */
.app-icon[data-app="yigui"] .icon-wrapper svg { color: #7c9cbf !important; }     /* 仪轨黛青 */
.app-icon[data-app="shopping"] .icon-wrapper svg { color: #ff6b35 !important; }  /* 淘宝橙 */
.app-icon[data-app="encounter"] .icon-wrapper svg { color: #a78bfa !important; } /* 邂逅紫 */
.app-icon[data-app="settings"] .icon-wrapper svg { color: #64748b !important; }  /* 烟灰钛 */
.app-icon[data-app="heartgame"] .icon-wrapper svg { color: #e879a6 !important; } /* 心动粉莓（v1.5.21 新增） */
.app-icon[data-app="placeholder"] .icon-wrapper svg { color: #8fa8d8 !important; }/* 占位雾蓝（v1.5.21 新增） */

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

    // 绑定小部件落地槽位（播放器组件已移除，槽位 36 让给工作台图标）
    placedDesktop: {
      "0": "widget_clear_summer_top",
      "12": "widget_clear_summer_polaroid",
      "20": "widget_clear_summer_dialogue"
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

      // === 第二页 (20~39) === 槽位 32-35 为四个应用，槽位 36 为工作台，槽位 37 为仪轨（原播放器组件已移除）
      null, null, null, null,
      null, null, null, null,
      null, null, null, null,
      "couples", "music", "shopping", "quicktravel",
      // 槽位 37 仪轨 → 38 心动游戏 → 39 占位图标（v1.5.21 新增，紧跟在仪轨后面）
      "workbench", "yigui", "heartgame", "placeholder"
    ],

    // 底部 Dock 栏排布
    dockLayout: ["settings", "chat", "archive", "world_book"]
  },

  /* ============================================================
   * 薄秋（默认主题）—— M3E Canvas 设计稿落地 + 淡彩配色
   * 大时钟（下面一行可编辑小字）+ 照片卡片 + 圆形图标按钮 + 横幅 + 搜索条
   * 4 列 × 7 行 = 每页 28 格；所有视觉只写在本主题的 activeCss 里，绝不影响清透凉夏
   * ============================================================ */
  thin_autumn: {
    name: "薄秋",
    rows: 7,            // 4 列 × 7 行 = 每页 28 格
    pageSize: 28,
    /* 设计稿尺寸（412×892 的画布）：所有几何按手机宽度等比缩放，不另做适配 */
    metrics: {
      designW: 412,
      top: 40,          // 第一行距桌面顶部的留白（比设计稿再收一点，给 dock 留出完整高度）
      rowH: 91,         // 行高（设计稿单位）
      gapY: 6,          // 行间距
      gapX: 9,          // 列间距
      padL: 23,         // 左边距（设计稿里照片在 x=23）
      padR: 16,         // 右边距
      icon: 56,         // 圆形图标按钮直径
      dockBtnW: 80,     // dock 按钮宽（首尾两个按设计稿放 100）
      dockBtnH: 56      // dock 按钮高
    },
    confirmText: "确定要应用【薄秋】主题吗？桌面会换成 7 行布局（大时钟 / 照片卡 / 圆形图标 / 横幅 / 搜索条），壁纸换成淡彩纯色底。",
    wallpaper: "",
    dockOpacity: "72",
    activeCss: `/* 薄秋 — 淡彩配色 · 按 412 宽设计稿等比缩放（几何由 metrics 驱动） */
/* 底色：奶油 → 淡紫 → 淡蓝 的极淡渐变（用户自己上传了壁纸时让壁纸优先） */
#phone-container {
  background-color: #FBF8F4 !important;
}
#phone-container:not(.has-wallpaper) {
  background-image: linear-gradient(160deg, #FDF9F3 0%, #F8F4FA 52%, #F2F6FA 100%) !important;
  background-size: cover !important;
}
/* 桌面本身不留白，全部由网格按设计稿的边距决定；滚动条不占宽度 */
#desktop {
  padding: 0 !important;
  scrollbar-width: none !important;
}
#desktop::-webkit-scrollbar {
  width: 0 !important;
  display: none !important;
}
/* 槽位不锁比例，高度由设计稿行高决定；图标贴行顶部 */
.desktop-slot {
  aspect-ratio: auto !important;
  height: 100% !important;
  align-items: flex-start !important;
}
.app-icon {
  width: 100% !important;
}

/* 圆形图标按钮：淡彩底 + 同色系图标 + 极轻投影 */
.app-icon .icon-wrapper {
  width: var(--desktop-icon, 56px) !important;
  height: var(--desktop-icon, 56px) !important;
  border-radius: 50% !important;
  background: #FFFFFF !important;
  border: none !important;
  box-shadow: 0 2px 10px rgba(120, 110, 130, 0.10) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  margin-bottom: 0 !important;
  transition: transform 0.16s ease !important;
}
.app-icon:active .icon-wrapper {
  transform: scale(0.93) !important;
}
.app-icon .icon-wrapper svg {
  width: 24px !important;
  height: 24px !important;
  filter: none !important;
}
/* 与设计稿一致：桌面图标不显示名称（span 仍保留在 DOM 中供读屏） */
.app-icon span {
  display: none !important;
}
/* 每个应用的淡彩底色与图标色（马卡龙 / 莫兰迪） */
.app-icon[data-app="chat"] .icon-wrapper { background: #EAF3FF !important; }
.app-icon[data-app="chat"] .icon-wrapper svg { color: #6E96CB !important; }
.app-icon[data-app="deeptalk"] .icon-wrapper { background: #F0EBFF !important; }
.app-icon[data-app="deeptalk"] .icon-wrapper svg { color: #8F82D2 !important; }
.app-icon[data-app="reader"] .icon-wrapper { background: #FFF4E8 !important; }
.app-icon[data-app="reader"] .icon-wrapper svg { color: #C79463 !important; }
.app-icon[data-app="forum"] .icon-wrapper { background: #E8F7F1 !important; }
.app-icon[data-app="forum"] .icon-wrapper svg { color: #5FAE96 !important; }
.app-icon[data-app="couples"] .icon-wrapper { background: #FFEDF3 !important; }
.app-icon[data-app="couples"] .icon-wrapper svg { color: #D07E9A !important; }
.app-icon[data-app="archive"] .icon-wrapper { background: #EEF1FF !important; }
.app-icon[data-app="archive"] .icon-wrapper svg { color: #7C8CD6 !important; }
.app-icon[data-app="world_book"] .icon-wrapper { background: #E9F6F7 !important; }
.app-icon[data-app="world_book"] .icon-wrapper svg { color: #5FA8AD !important; }
.app-icon[data-app="music"] .icon-wrapper { background: #FFEFF6 !important; }
.app-icon[data-app="music"] .icon-wrapper svg { color: #C97BA6 !important; }
.app-icon[data-app="shopping"] .icon-wrapper { background: #FFF1E9 !important; }
.app-icon[data-app="shopping"] .icon-wrapper svg { color: #D08A6A !important; }
.app-icon[data-app="encounter"] .icon-wrapper { background: #F2EEFF !important; }
.app-icon[data-app="encounter"] .icon-wrapper svg { color: #9186CE !important; }
.app-icon[data-app="quicktravel"] .icon-wrapper { background: #EDF6EE !important; }
.app-icon[data-app="quicktravel"] .icon-wrapper svg { color: #6FA97A !important; }
.app-icon[data-app="workbench"] .icon-wrapper { background: #EAF4FA !important; }
.app-icon[data-app="workbench"] .icon-wrapper svg { color: #6E9CBF !important; }
.app-icon[data-app="yigui"] .icon-wrapper { background: #F6F1E7 !important; }
.app-icon[data-app="yigui"] .icon-wrapper svg { color: #A08B63 !important; }
.app-icon[data-app="settings"] .icon-wrapper { background: #F2F3F6 !important; }
.app-icon[data-app="settings"] .icon-wrapper svg { color: #8A8FA0 !important; }
.app-icon[data-app="heartgame"] .icon-wrapper { background: #FFEBF3 !important; }
.app-icon[data-app="heartgame"] .icon-wrapper svg { color: #D97FA8 !important; }
.app-icon[data-app="placeholder"] .icon-wrapper { background: #EDF2FB !important; }
.app-icon[data-app="placeholder"] .icon-wrapper svg { color: #7E97C9 !important; }

/* Dock：图标直接放在容器里，不做背景色块；宽度按设计稿 100 / 80 / 80 / 100 刚好排满 */
#dock {
  padding: calc(8px * var(--desk-s, 1)) calc(10px * var(--desk-s, 1)) calc(14px + env(safe-area-inset-bottom, 0px)) calc(10px * var(--desk-s, 1)) !important;
}
.dock-container {
  background-color: rgba(255, 255, 255, 0.82) !important;
  border: 1px solid rgba(232, 228, 238, 0.9) !important;
  border-radius: calc(28px * var(--desk-s, 1)) !important;
  height: calc(56px * var(--desk-s, 1)) !important;
  padding: 0 calc(4px * var(--desk-s, 1)) !important;
  box-shadow: 0 6px 18px rgba(140, 130, 150, 0.10) !important;
  box-sizing: border-box !important;
}
#dock-grid {
  gap: calc(8px * var(--desk-s, 1)) !important;
}
#dock-grid > .dock-slot {
  width: calc(80px * var(--desk-s, 1)) !important;
  flex: 0 0 calc(80px * var(--desk-s, 1)) !important;
  aspect-ratio: auto !important;
  height: 100% !important;
}
#dock-grid > .dock-slot:first-child,
#dock-grid > .dock-slot:last-child {
  width: calc(100px * var(--desk-s, 1)) !important;
  flex: 0 0 calc(100px * var(--desk-s, 1)) !important;
}
#dock-grid .app-icon {
  width: 100% !important;
}
/* 纯图标：没有白色底块、没有投影、没有圆角背景 */
#dock-grid .app-icon .icon-wrapper {
  width: 100% !important;
  height: calc(56px * var(--desk-s, 1)) !important;
  border-radius: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
#dock-grid .app-icon .icon-wrapper svg {
  width: 24px !important;
  height: 24px !important;
}

/* 翻页指示器：淡彩小胶囊 */
#desktop-page-indicator {
  height: auto !important;
  width: fit-content !important;
  margin: 2px auto 8px auto !important;
  padding: 5px 10px !important;
  gap: 6px !important;
  border-radius: 99px !important;
  background: rgba(255, 255, 255, 0.82) !important;
  box-shadow: 0 2px 8px rgba(140, 130, 150, 0.10) !important;
}
.page-dot {
  background-color: rgba(160, 150, 170, 0.28) !important;
}
.page-dot.active {
  background-color: #A08FB8 !important;
}

/* 翻页滑入（只用淡入，不做位移，避免把内容推出屏幕） */
@keyframes thinAutumnPageIn { from { opacity: 0; } to { opacity: 1; } }
#desktop-grid.page-anim-r,
#desktop-grid.page-anim-l { animation: thinAutumnPageIn 0.22s ease-out; }`,
    /* 设计稿里的 Material Symbols 图标（切到别的主题会自动还原成原生图标） */
    iconOverrides: {
      world_book: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM437-141v-82q-35 0-59-26t-24-61v-44L149-559q-5 20-7 39.5t-2 39.5q0 130 84.5 227T437-141Zm294-108q44-48 66.5-107.5T820-480q0-106-58-192.5T607-799v18q0 35-24 61t-59 26h-87v87q0 17-13.5 28T393-568h-83v88h258q17 0 28 13t11 30v127h43q29 0 51 17t30 44Z\"/></svg>",
      settings: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M421-80q-14 0-25-9t-13-23l-15-94q-19-7-40-19t-37-25l-86 40q-14 6-28 1.5T155-226L97-330q-8-13-4.5-27t15.5-23l80-59q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521l-80-59q-12-9-15.5-23t4.5-27l58-104q8-13 22-17.5t28 1.5l86 40q16-13 37-25t40-18l15-95q2-14 13-23t25-9h118q14 0 25 9t13 23l15 94q19 7 40.5 18.5T669-710l86-40q14-6 27.5-1.5T804-734l59 104q8 13 4.5 27.5T852-580l-80 57q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l80 58q12 8 15.5 22.5T863-330l-58 104q-8 13-22 17.5t-28-1.5l-86-40q-16 13-36.5 25.5T592-206l-15 94q-2 14-13 23t-25 9H421Zm15-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z\"/></svg>",
      archive: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M300-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560ZM180-80q-24 0-42-18t-18-42v-590q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v590h470q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32Q662.75-80 650-80H180Zm120-180v-560 560Z\"/></svg>",
      chat: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M240-240 131-131q-14 14-32.5 6.34Q80-132.31 80-152v-668q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240Zm-26-60h606v-520H140v600l74-80Zm-74 0v-520 520Z\"/></svg>",
      music: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M124.5-163.5Q81-207 81-270t43.5-106.5Q168-420 231-420q28 0 50.5 8t39.5 22v-345q0-11 7-19t18-10l419-70q14-2 24.5 6.5T800-805v455q0 63-43.5 106.5T650-200q-63 0-106.5-43.5T500-350q0-63 43.5-106.5T650-500q28 0 50.5 8t39.5 22v-184l-359 60v324q0 63-43.5 106.5T231-120q-63 0-106.5-43.5Z\"/></svg>",
      reader: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M132-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h696q24 0 42 18t18 42v600q0 24-18 42t-42 18H132Zm0-60h696v-600H132v600Zm228-100q17 0 28.5-11.5T400-320q0-17-11.5-28.5T360-360H240q-17 0-28.5 11.5T200-320q0 17 11.5 28.5T240-280h120Zm222-193-29-29q-12-12-28-11.5T497-501q-11 12-11.5 28t11.5 28l64 64q9 9 21 9t21-9l149-149q12-12 12-28t-12-28q-12-12-28.5-12T695-586L582-473Zm-222 33q17 0 28.5-11.5T400-480q0-17-11.5-28.5T360-520H240q-17 0-28.5 11.5T200-480q0 17 11.5 28.5T240-440h120Zm0-160q17 0 28.5-11.5T400-640q0-17-11.5-28.5T360-680H240q-17 0-28.5 11.5T200-640q0 17 11.5 28.5T240-600h120ZM132-180v-600 600Z\"/></svg>",
      yigui: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M700-200h-90q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h90v-90q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v90h90q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-90v90q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Q700-97.25 700-110v-90Zm-520 40q-24 0-42-18t-18-42v-540q0-24 18-42t42-18h65v-28q0-13.6 9-22.8 9-9.2 23.02-9.2t23.5 9.2Q310-861.6 310-848v28h260v-28q0-13.6 9-22.8 9-9.2 23.02-9.2t23.5 9.2Q635-861.6 635-848v28h65q24 0 42 18t18 42v269q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-79H180v350h290q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H180Zm0-470h520v-130H180v130Zm0 0v-130 130Z\"/></svg>",
      shopping: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M236-102.21q-21-21.21-21-51T236.21-204q21.21-21 51-21T338-203.79q21 21.21 21 51T337.79-102q-21.21 21-51 21T236-102.21Zm400 0q-21-21.21-21-51T636.21-204q21.21-21 51-21T738-203.79q21 21.21 21 51T737.79-102q-21.21 21-51 21T636-102.21ZM235-741l110 228h288l125-228H235Zm-30-60h589.07q22.97 0 34.95 21 11.98 21-.02 42L694-495q-11 19-28.56 30.5T627-453H324l-56 104h461q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H277q-42 0-60.5-28t.5-63l64-118-152-322H81q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32Q68.25-880 81-880h68q9 0 16.2 4.43 7.2 4.44 10.8 12.57l29 62Zm140 288h288-288Z\"/></svg>",
      deeptalk: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M850.33-123q-5.33 0-10.83-2t-10.5-7L721-240H300q-24.75 0-42.37-17.63Q240-275.25 240-300v-80h440q24.75 0 42.38-17.63Q740-415.25 740-440v-280h80q24.75 0 42.38 17.62Q880-684.75 880-660v507q0 14-9.5 22t-20.17 8ZM140-425l75-75h405v-320H140v395Zm-30.33 103Q99-322 89.5-330q-9.5-8-9.5-22v-468q0-24.75 17.63-42.38Q115.25-880 140-880h480q24.75 0 42.38 17.62Q680-844.75 680-820v320q0 24.75-17.62 42.37Q644.75-440 620-440H240L131-331q-5 5-10.5 7t-10.83 2ZM140-500v-320 320Z\"/></svg>",
      couples: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"m562-110 248-78q0-20-15.5-34T758-235H549q-16 1-31.5-2t-30.5-8l-66-20q-12-4-18-16t-2-24q4-12 15.28-18t23.72-1l64 21q11 4 22.5 6t22.5 2h56q2 0 0 0 0-21-14-36.5T557-355l-218-83h-84v238l307 90Zm-13 57-294-84q-2 27-22.5 42T195-80h-95q-24.75 0-42.37-17.63Q40-115.25 40-140v-298q0-24.75 17.63-42.38Q75.25-498 100-498h238q5.33 0 10.67 1 5.33 1 10.33 3l218 82q42 16 66.5 46t24.5 71h90q50.83 0 86.42 37Q880-221 880-170q0 11-5.5 20T859-138L583-53q-8.17 2-17.09 2Q557-51 549-53Zm-449-87h94v-298h-94v298Zm524-344.5q-11-4.5-20-12.5L482-616q-29.32-27.74-49.66-61.49Q412-711.24 412-751q0-53 35-91t87-38q34 0 62 17.5t50 43.5q22-26 50-43.5t62-17.5q52 0 87 38t35 91q0 39.66-20.5 73.33T810-616L688-497q-9 8-19.81 12.5-10.82 4.5-22 4.5-11.19 0-22.19-4.5Zm22-54.5 120-119q20.12-19.85 37.06-42.32T820-751q0-28-17.5-48.5T758-820q-20 0-37 11t-30 27l-21.66 27.14Q660.38-744 646.19-744q-14.19 0-23.26-10.86L601-782q-13-16-30-27t-37-11q-27 0-44.5 20.5T472-751q0 28.21 16.94 50.68T526-658l120 119Zm0-188Z\"/></svg>",
      encounter: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M169.86-485Q132-485 106-511.14t-26-64Q80-613 106.14-639t64-26Q208-665 234-638.86t26 64Q260-537 233.86-511t-64 26ZM291-681.14q-26-26.14-26-64T291.14-809q26.14-26 64-26T419-808.86q26 26.14 26 64T418.86-681q-26.14 26-64 26T291-681.14Zm250 0q-26-26.14-26-64T541.14-809q26.14-26 64-26T669-808.86q26 26.14 26 64T668.86-681q-26.14 26-64 26T541-681.14ZM789.86-485Q752-485 726-511.14t-26-64Q700-613 726.14-639t64-26Q828-665 854-638.86t26 64Q880-537 853.86-511t-64 26ZM266-75q-42 0-69-31.53-27-31.52-27-74.47 0-42 25.5-74.5T250-318q22-22 41-46.5t36-50.5q29-44 65-82t88-38q52 0 88.5 38t65.5 83q17 26 35.5 50t40.5 46q29 30 54.5 62.5T790-181q0 42.95-27 74.47Q736-75 694-75q-54 0-107-9t-107-9q-54 0-107 9t-107 9Z\"/></svg>",
      forum: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M30-240q-12.75 0-21.37-8.63Q0-257.25 0-270v-23q0-38.57 41.5-62.78Q83-380 150.38-380q12.16 0 23.39.5t22.23 2.15q-8 17.35-12 35.17-4 17.81-4 37.18v65H30Zm240 0q-12.75 0-21.37-8.63Q240-257.25 240-270v-35q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v35q0 12.75-8.62 21.37Q702.75-240 690-240H270Zm510 0v-65q0-19.86-3.5-37.43T765-377.27q11-1.73 22.17-2.23 11.17-.5 22.83-.5 67.5 0 108.75 23.77T960-293v23q0 12.75-8.62 21.37Q942.75-240 930-240H780Zm-480-60h360v-6q0-37-50.5-60.5T480-390q-79 0-129.5 23.5T300-305v5ZM149.57-410q-28.57 0-49.07-20.56Q80-451.13 80-480q0-29 20.56-49.5Q121.13-550 150-550q29 0 49.5 20.5t20.5 49.93q0 28.57-20.5 49.07T149.57-410Zm660 0q-28.57 0-49.07-20.56Q740-451.13 740-480q0-29 20.56-49.5Q781.13-550 810-550q29 0 49.5 20.5t20.5 49.93q0 28.57-20.5 49.07T809.57-410ZM480-480q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm.35-60Q506-540 523-557.35t17-43Q540-626 522.85-643t-42.5-17q-25.35 0-42.85 17.15t-17.5 42.5q0 25.35 17.35 42.85t43 17.5ZM480-300Zm0-300Z\"/></svg>",
      workbench: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M740-149 517-371l57-57 223 223q12 12 12 28t-12 28q-12 12-28.5 12T740-149Zm-593-28.5q0-16.5 12-28.5l261-261-107-107-2 2q-9 9-21 9t-21-9l-23-23v97q0 10-9.5 13.5T220-488L102-606q-7-7-3.5-16.5T112-632h98l-27-27q-9-9-9-21t9-21l110-110q17-17 37-23t44-6q21 0 36 5.5t32 18.5q5 5 5.5 11t-4.5 11l-95 95 27 27q9 9 9 21t-9 21l-3 3 104 104 122-122q-8-13-12.5-30t-4.5-36q0-53 38.5-91.5T711-841q8 0 14.5.5T737-838q6 3 7.5 9.5T741-817l-61 61q-5 5-5 11t5 11l53 53q5 5 11 5t11-5l59-59q5-5 13-4t11 8q2 6 2.5 12.5t.5 14.5q0 53-38.5 91.5T711-579q-18 0-31-2.5t-24-7.5L215-148q-12 12-28 11.5T159-149q-12-12-12-28.5Z\"/></svg>",
      quicktravel: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M232-247h239v-14q0-18-9-32t-23-19q-32-11-50-14.5t-35-3.5q-19 0-40.5 4.5T265-312q-15 5-24 19t-9 32v14Zm361-67h120q11 0 18-7t7-18q0-11-7-18t-18-7H593q-11 0-18 7t-7 18q0 11 7 18t18 7Zm-200.5-65.5Q408-395 408-418t-15.5-38.5Q377-472 354-472t-38.5 15.5Q300-441 300-418t15.5 38.5Q331-364 354-364t38.5-15.5ZM593-427h120q11 0 18-7t7-18q0-11-7-18t-18-7H593q-11 0-18 7t-7 18q0 11 7 18t18 7ZM140-80q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h250v-140q0-24 18-42t42-18h60q24 0 42 18t18 42v140h250q24 0 42 18t18 42v480q0 24-18 42t-42 18H140Zm0-60h680v-480H570v30q0 28-18 44t-42 16h-60q-24 0-42-16t-18-44v-30H140v480Zm310-450h60v-230h-60v230Zm30 210Z\"/></svg>",
      // v1.5.21 新增：心动游戏（fingerprint）+ 占位图标（key），取自设计稿的 Material Symbols Rounded
      heartgame: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M481-781q106 0 200 45.5T838-604q7 9 4.5 16t-8.5 12q-6 5-14 4.5t-14-8.5q-55-78-141.5-119.5T481-741q-97 0-182 41.5T158-580q-6 9-14 10t-14-4q-7-5-8.5-12.5T126-602q62-85 155.5-132T481-781Zm0 94q135 0 232 90t97 223q0 50-35.5 83.5T688-257q-51 0-87.5-33.5T564-374q0-33-24.5-55.5T481-452q-34 0-58.5 22.5T398-374q0 97 57.5 162T604-121q9 3 12 10t1 15q-2 7-8 12t-15 3q-104-26-170-103.5T358-374q0-50 36-84t87-34q51 0 87 34t36 84q0 33 25 55.5t59 22.5q34 0 58-22.5t24-55.5q0-116-85-195t-203-79q-118 0-203 79t-85 194q0 24 4.5 60t21.5 84q3 9-.5 16T208-205q-8 3-15.5-.5T182-217q-15-39-21.5-77.5T154-374q0-133 96.5-223T481-687Zm0-192q64 0 125 15.5T724-819q9 5 10.5 12t-1.5 14q-3 7-10 11t-17-1q-53-27-109.5-41.5T481-839q-58 0-114 13.5T260-783q-8 5-16 2.5T232-791q-4-8-2-14.5t10-11.5q56-30 117-46t124-16Zm0 289q93 0 160 62.5T708-374q0 9-5.5 14.5T688-354q-8 0-14-5.5t-6-14.5q0-75-55.5-125.5T481-550q-76 0-130.5 50.5T296-374q0 81 28 137.5T406-123q6 6 6 14t-6 14q-6 6-14 6t-14-6q-59-62-90.5-126.5T256-374q0-91 66-153.5T481-590Zm-1 196q9 0 14.5 6t5.5 14q0 75 54 123t126 48q6 0 17-1t23-3q9-2 15.5 2.5T744-191q2 8-3 14t-13 8q-18 5-31.5 5.5t-16.5.5q-89 0-154.5-60T460-374q0-8 5.5-14t14.5-6Z\"/></svg>",
      placeholder: "<svg viewBox=\"0 -960 960 960\"><path fill=\"currentColor\" d=\"M280-400q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Zm0 160q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h335q8 0 15.5 3t13.5 9l80 80q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L805-325q-5 5-12 8t-14 4q-7 1-14-1t-13-7l-52-39-57 43q-5 4-11 6t-12 2q-6 0-12.5-2t-11.5-6l-61-43h-47q-32 54-86.5 87T280-240Zm0-80q56 0 98.5-34t56.5-86h125l58 41v.5-.5l82-61 71 55 75-75h-.5.5l-40-40v-.5.5H435q-14-52-56.5-86T280-640q-66 0-113 47t-47 113q0 66 47 113t113 47Z\"/></svg>",
    },
    widgets: {
      // 顶部大时钟（4 列 × 2 行），下面一行小字可点开编辑
      tile_thin_autumn_clock: {
        id: "tile_thin_autumn_clock",
        name: "大时钟",
        tile: "clock",
        widthSpan: 4,
        heightSpan: 2,
        fixedH: 150,     // 设计稿：时钟文字 57 → 再大一倍（下面还有一行小字，所以块高留 150）
        config: { size: 114, colon: ":", color: "#6B6275", subColor: "#A79FAE" }
      },
      // 三张照片卡片（点击上传，持久保存），高度按设计稿 182 / 240
      tile_thin_autumn_photo_a: {
        id: "tile_thin_autumn_photo_a",
        name: "照片 · 左上",
        tile: "photo",
        widthSpan: 2,
        heightSpan: 2,
        fixedH: 182,
        config: { key: "a", maxPx: 1200 }
      },
      tile_thin_autumn_photo_b: {
        id: "tile_thin_autumn_photo_b",
        name: "照片 · 右下",
        tile: "photo",
        widthSpan: 2,
        heightSpan: 2,
        fixedH: 182,
        config: { key: "b", maxPx: 1200 }
      },
      tile_thin_autumn_photo_c: {
        id: "tile_thin_autumn_photo_c",
        // v1.5.21：新设计稿里右下角这张从「竖版 182×240」改成了正方形 182×182（box size=182 size2=182），
        // 与第一页的照片 A/B 同尺寸；因此占位也从 2×3 收到 2×2
        name: "照片 · 右下",
        tile: "photo",
        widthSpan: 2,
        heightSpan: 2,
        fixedH: 182,
        // 显式落在第 3 列（设计稿 x=214 = 右侧两列）；
        // 不声明的话会被 grid 自动排到左边两列（用户报的「图片跑到左边」就是这个）
        colStart: 3,
        config: { key: "c", maxPx: 1200 }
      },
      // 第二页横幅（背景图 + 可编辑文字），设计稿 380×223
      tile_thin_autumn_banner: {
        id: "tile_thin_autumn_banner",
        name: "叙事诗横幅",
        tile: "banner",
        widthSpan: 4,
        heightSpan: 3,
        fixedH: 223,
        config: { key: "main", title: "叙事诗", sub: "这是我们的漫长的叙事史诗", radius: 28 }
      },
      // 第二页搜索条（点击跳听歌搜索），设计稿 380×56
      tile_thin_autumn_search: {
        id: "tile_thin_autumn_search",
        name: "搜索条",
        tile: "search",
        widthSpan: 4,
        heightSpan: 1,
        fixedH: 56,
        config: { label: "搜索歌曲" }
      }
    },

    // 卡片落位（28 格/页的槽位号）
    // 说明：网格是 grid-auto-flow:row，槽位号决定「第几行第几个」；要让卡片落在
    //       指定列上，需要额外声明 colStart（1 基列号），见下方照片 C。
    placedDesktop: {
      "4": "tile_thin_autumn_clock",     // 第一页 第2-3行 整宽（设计稿 y=150）
      "12": "tile_thin_autumn_photo_a",  // 第一页 第4-5行 左两列（y=337）
      "22": "tile_thin_autumn_photo_b",  // 第一页 第6-7行 右两列（y=535）
      "28": "tile_thin_autumn_banner",   // 第二页 第1-3行 整宽（y=57）
      "40": "tile_thin_autumn_search",   // 第二页 第4行 整宽（y=343）
      // 第二页 第6-7行（设计稿 x=214 / y=521，正方形 182×182）
      // v1.5.21：第 5 行补入 心动游戏/占位图标，照片 C 由「2×3 竖版」缩为「2×2 正方形」；
      //          同时必须显式声明 colStart:3，否则自动排布会把它挤到左边两列
      "50": "tile_thin_autumn_photo_c"
    },

    // 两页图标排布（每页 28 格：4 列 × 7 行；行位置按设计稿 y=150/337/428/519/535/637… 对齐）
    desktopLayout: [
      // === 第一页 ===
      // 第1行：空（设计稿顶部留白）
      null, null, null, null,
      // 第2-3行：大时钟（4×2，覆盖 4-11）
      null, null, null, null,
      null, null, null, null,
      // 第4行：照片 A（2×2，覆盖 12,13,16,17） + 世界书 + 设置
      null, null, "world_book", "settings",
      // 第5行：照片 A 继续 + 档案库 + 聊天
      null, null, "archive", "chat",
      // 第6行：听歌 + 阅读 + 照片 B（2×2，覆盖 22,23,26,27）
      "music", "reader", null, null,
      // 第7行：仪轨 + 购物 + 照片 B 继续
      "yigui", "shopping", null, null,

      // === 第二页 ===
      // 第1-3行：叙事诗横幅（4×3，覆盖 28-39）
      null, null, null, null,
      null, null, null, null,
      null, null, null, null,
      // 第4行：搜索条（4×1，覆盖 40-43）
      null, null, null, null,
      // 第5行：深谈 + 情侣空间 + 心动游戏 + 占位图标（v1.5.21 新增，按新设计稿补在情侣空间之后）
      //        照片 C（2×3）下移到 24/25，覆盖 48,49,52,53,56,57
      "deeptalk", "couples", "heartgame", "placeholder",
      // 第6行：邂逅 + 论坛 + 照片 C 继续
      "encounter", "forum", null, null,
      // 第7行：工作台 + 快穿局 + 照片 C 继续
      "workbench", "quicktravel", null, null
    ],

    // 底部 Dock 栏排布（与设计稿一致：设置 / 聊天 / 档案库 / 世界书）
    dockLayout: ["settings", "chat", "archive", "world_book"]
  }
};

/** 静默应用预设（不弹确认框），用于「全新安装默认用 M3 桌面」 */
window.applyPresetSilently = function(key) {
  const preset = window.DESKTOP_PRESETS[key];
  if (!preset) return false;
  applyPresetCore(preset);
  return true;
};

/** 预设核心：行数/页宽 → 壁纸 → 全局 CSS → 小部件库 → 卡片落位 → 桌面排版 → 重绘 */
function applyPresetCore(preset, silent) {
    // 0. 先定行数/页宽：每个预设自带规格（M3 桌面 7 行 28 格；清透凉夏 5 行 20 格），
    //    这样旧预设的小部件跨行/排版不会被 7 行网格打乱
    const rows = preset.rows || 5;
    const pageSize = preset.pageSize || (4 * rows);
    if (typeof window.setDesktopGridRows === "function") window.setDesktopGridRows(rows);
    try { localStorage.setItem("desktop-page-size", String(pageSize)); } catch(e) {}

    // 1. 设置背景与 Dock 不透明度（wallpaper:"" 表示清空壁纸，走纯色底）
    if (Object.prototype.hasOwnProperty.call(preset, "wallpaper")) {
      localStorage.setItem("beautify-wallpaper", preset.wallpaper || "");
    }
    if (preset.dockOpacity) {
      localStorage.setItem("beautify-dock-opacity", preset.dockOpacity);
    }

    // 2. 设置全局 CSS
    if (preset.activeCss) {
      localStorage.setItem("beautify-active-css", preset.activeCss);
    }

    // 2.5 主题图标覆盖：薄秋用设计稿里的 Material Symbols；其它主题清空，回到原生图标
    try {
      localStorage.setItem("beautify-icon-overrides", JSON.stringify(preset.iconOverrides || {}));
    } catch(e) {}

    // 2.6 设计稿尺寸（薄秋）：几何按 412 宽设计稿等比缩放；其它主题清空，回到原版行为
    try {
      if (preset.metrics) localStorage.setItem("beautify-desktop-metrics", JSON.stringify(preset.metrics));
      else localStorage.removeItem("beautify-desktop-metrics");
    } catch(e) {}

    // 3. 写入内置小部件库
    if (preset.widgets) {
      let existingWidgets = {};
      try { existingWidgets = JSON.parse(localStorage.getItem("beautify-widgets")) || {}; } catch(e) {}
      Object.assign(existingWidgets, preset.widgets);
      localStorage.setItem("beautify-widgets", JSON.stringify(existingWidgets));
    }

    // 4. 设置桌面摆放小部件（preset.pageSize 未写时按旧版每页 20 格，按页重排到当前页宽）
    if (preset.placedDesktop) {
      const from = preset.pageSize || window.DESKTOP_LEGACY_PAGE_SIZE || 20;
      const to = window.DESKTOP_PAGE_SIZE || 20;
      let placed = preset.placedDesktop;
      if (from !== to) {
        const next = {};
        Object.keys(placed).forEach((k) => {
          const idx = parseInt(k, 10);
          if (isNaN(idx)) { next[k] = placed[k]; return; }
          next[Math.floor(idx / from) * to + (idx % from)] = placed[k];
        });
        placed = next;
      }
      localStorage.setItem("placed-widgets-desktop", JSON.stringify(placed));
    }

    // 5. 设置桌面与 Dock 排版
    if (preset.desktopLayout) {
      const from = preset.pageSize || window.DESKTOP_LEGACY_PAGE_SIZE || 20;
      const remapped = typeof window.remapDesktopLayout === "function"
        ? window.remapDesktopLayout(preset.desktopLayout, from, window.DESKTOP_PAGE_SIZE || 20)
        : preset.desktopLayout;
      localStorage.setItem("desktop-layout-v3", JSON.stringify(remapped));
    }
    if (preset.dockLayout) {
      localStorage.setItem("dock-layout-v3", JSON.stringify(preset.dockLayout));
    }
    // 迁移标记：预设已按当前页宽写入，避免随后又被 migrateDesktopPageSize 二次重排
    try { localStorage.setItem("desktop-page-size", String(window.DESKTOP_PAGE_SIZE || pageSize)); } catch(e) {}

    if (!silent && typeof showToast === "function") {
      showToast(`已成功应用预设: ${preset.name}`);
    }

    // 6. 立即触发全局重绘
    if (typeof window.applyGlobalSettingsOnLoad === "function") window.applyGlobalSettingsOnLoad();
    if (typeof window.loadDesktopLayout === "function") window.loadDesktopLayout();
    if (!silent && typeof window.loadBeautifyForm === "function") window.loadBeautifyForm();
}

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
  // 使用系统自研卡片 Confirm，彻底弃用原生 confirm 弹窗
  if (typeof showCustomConfirm === "function") {
    showCustomConfirm("应用UI主题预设", preset.confirmText || `确定要应用【${preset.name}】UI预设吗？`, () => applyPresetCore(preset, false));
  } else {
    applyPresetCore(preset, false);
  }
};