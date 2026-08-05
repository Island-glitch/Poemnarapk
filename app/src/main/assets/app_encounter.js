/**
 * app_encounter.js - 邂逅应用（Soul 风格星球轨道社交）
 * ------------------------------------------------------------
 * 核心特性：
 *   1. 首页行星系模型：每个小行星代表一个陌生 char，点击展开人设卡片
 *   2. 标签仓库：管理匹配陌生 char 的标签（增删）
 *   3. 胶囊式 Dock：左广场 / 中首页 / 右发布
 *   4. 广场帖子流：分类切换（推荐/交友/同城/国际/古代…），分类可管理
 *   5. 发布瞬间：标题/正文/配图，发布后自动有 char 留言
 *   6. 转正机制：交流按钮把陌生 char 加入档案馆邂逅分类，并从邂逅移除
 *
 * UI 风格：Soul 色系（深空紫 + 星河粉 + 极光青），纯 SVG 图标，无新增 emoji
 * 数据存储：Dexie encounter_* 表族（见 db.js v30）
 * ============================================================
 */
(function () {
  'use strict';

  // ============================================================
  // 0. Soul 色系常量与运行时样式注入
  // ============================================================
  const SOUL_COLORS = {
    bgDeep:    '#fdf2f8',  // 浅粉白
    bgMid:     '#faf5ff',  // 浅紫白
    bgSoft:    '#f5f0ff',  // 淡薰衣草
    purple:    '#7c5ce7',
    purpleSoft:'#9b8afe',
    pink:      '#fd79a8',
    pinkSoft:  '#fab1d4',
    cyan:      '#0984e3',
    cyanSoft:  '#74b9ff',
    gold:      '#f5a623',
    textMain:  '#3d2c5e',   // 深紫文字（浅底配深字）
    textSub:   '#7a6a9e',   // 中紫副文字
    border:    'rgba(124, 92, 231, 0.18)'
  };

  function injectEncounterStyles() {
    if (document.getElementById('encounter-style')) return;
    const style = document.createElement('style');
    style.id = 'encounter-style';
    style.textContent = `
      /* === 邂逅应用根容器 === */
      #win-encounter {
        background: radial-gradient(ellipse at top, ${SOUL_COLORS.bgSoft} 0%, ${SOUL_COLORS.bgMid} 45%, ${SOUL_COLORS.bgDeep} 100%) !important;
        color: ${SOUL_COLORS.textMain};
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
      }
      #win-encounter .win-header {
        background: linear-gradient(135deg, rgba(108,92,231,0.25), rgba(253,121,168,0.18)) !important;
        border-bottom: 1px solid ${SOUL_COLORS.border} !important;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }
      #win-encounter .win-header h3 { color: ${SOUL_COLORS.textMain} !important; }
      #win-encounter .win-header .btn-icon { color: ${SOUL_COLORS.textMain}; }

      /* === 主体区域 === */
      #encounter-body {
        position: relative;
        flex: 1;
        overflow: hidden;
        min-height: 0;
      }
      /* 全局隐藏所有滚动条（保留滚动功能）*/
      #encounter-body *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      #encounter-body * { scrollbar-width: none !important; }

      .encounter-tab-panel { display: none; height: 100%; }
      .encounter-tab-panel.active { display: flex; flex-direction: column; animation: enc-fade-in 0.4s ease; }

      @keyframes enc-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* === 行星系模型（立体星系·行星不自转）=== */
      #encounter-galaxy {
        position: relative;
        width: 100%;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        /* 远景星尘背景，强化空间纵深 */
        background:
          radial-gradient(1.5px 1.5px at 12% 22%, rgba(255,255,255,0.9), transparent 60%),
          radial-gradient(1.2px 1.2px at 78% 18%, rgba(255,255,255,0.7), transparent 60%),
          radial-gradient(1px 1px at 35% 70%, rgba(255,255,255,0.6), transparent 60%),
          radial-gradient(1.4px 1.4px at 88% 65%, rgba(255,255,255,0.8), transparent 60%),
          radial-gradient(1px 1px at 60% 85%, rgba(255,255,255,0.5), transparent 60%),
          radial-gradient(1.2px 1.2px at 22% 88%, rgba(255,255,255,0.7), transparent 60%),
          radial-gradient(ellipse at 50% 40%, rgba(124,92,231,0.10) 0%, transparent 70%);
      }
      /* 视窗切换按钮：星系/列表 */
      .galaxy-view-toggle {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 12;
        display: flex;
        gap: 4px;
        background: rgba(255,255,255,0.82);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 999px;
        padding: 3px;
        box-shadow: 0 4px 12px rgba(124,92,231,0.12);
      }
      .galaxy-view-toggle button {
        border: none;
        background: transparent;
        color: ${SOUL_COLORS.textSub};
        cursor: pointer;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        transition: all 0.2s;
      }
      .galaxy-view-toggle button.active {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
      }
      .galaxy-view-toggle button svg { width: 14px; height: 14px; }

      /* 列表视窗：char 列表（可滚动，无滚动条）*/
      #encounter-galaxy-list {
        position: absolute;
        inset: 0;
        z-index: 11;
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 14px 14px 80px;
        overflow-y: auto;
        background: linear-gradient(180deg, ${SOUL_COLORS.bgSoft} 0%, ${SOUL_COLORS.bgMid} 100%);
      }
      #encounter-galaxy-list.active { display: flex; }
      .galaxy-list-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.88);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 14px;
        cursor: pointer;
        transition: all 0.18s ease;
        animation: enc-fade-in 0.3s ease;
      }
      .galaxy-list-card:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124,92,231,0.14); }
      .galaxy-list-card img {
        width: 42px; height: 42px;
        border-radius: 50%;
        border: 2px solid ${SOUL_COLORS.border};
        flex-shrink: 0;
      }
      .galaxy-list-card-body { flex: 1; min-width: 0; }
      .galaxy-list-card-name {
        font-size: 13px; font-weight: 700; color: ${SOUL_COLORS.textMain};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .galaxy-list-card-sub {
        font-size: 10px; color: ${SOUL_COLORS.textSub}; margin-top: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .galaxy-list-card-tags { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; max-width: 40%; }
      .galaxy-list-card-tags .mini-tag {
        font-size: 9px; padding: 2px 7px; border-radius: 8px;
        background: rgba(124,92,231,0.12); color: ${SOUL_COLORS.purpleSoft};
      }
      .galaxy-stage {
        position: relative;
        width: 280px;
        height: 280px;
      }
      .galaxy-core {
        position: absolute;
        top: 50%; left: 50%;
        width: 44px; height: 44px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background-size: cover;
        background-position: center;
        background-color: ${SOUL_COLORS.purple};
        /* 多层光晕：模拟恒星光球与日冕体积，凸显中心星球立体感 */
        box-shadow:
          0 0 18px rgba(255,210,120,0.7),
          0 0 36px rgba(253,121,168,0.5),
          0 0 64px rgba(108,92,231,0.4),
          inset -4px -5px 10px rgba(60,30,100,0.45),
          inset 3px 3px 6px rgba(255,255,255,0.45);
        z-index: 6;
        animation: core-pulse 3.6s ease-in-out infinite;
      }
      .galaxy-core::before {
        /* 日冕外环：再叠一圈柔光，强化"发光球体"而非"圆点"的体积感 */
        content: '';
        position: absolute;
        inset: -9px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(253,121,168,0.32) 0%, rgba(108,92,231,0.16) 45%, transparent 72%);
        z-index: -1;
        filter: blur(2px);
      }
      @keyframes core-pulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); }
        50%      { transform: translate(-50%, -50%) scale(1.1); }
      }

      /* 轨道环：仅装饰，用 scaleY 压扁成椭圆呈俯视感；弱化描边。
         每条轨道可自带 --orbit-tilt 变量实现不同平面倾角（多平面星系）*/
      .galaxy-orbit {
        position: absolute;
        top: 50%; left: 50%;
        border: 1px dashed rgba(124,92,231,0.14);
        border-radius: 50%;
        transform: translate(-50%, -50%) scaleY(var(--orbit-tilt, 0.42));
        pointer-events: none;
      }
      .galaxy-planet {
        position: absolute;
        top: 0; left: 0;
        width: 22px; height: 22px;
        border-radius: 50%;
        cursor: pointer;
        /* 不做任何 3D 变换：行星始终保持正面朝向，头像清晰、不会像纸片翻转 */
        transform: translate(-50%, -50%);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        pointer-events: auto;
        background-size: cover;
        background-position: center;
        border: 1.5px solid rgba(255,255,255,0.6);
        box-shadow:
          0 0 8px var(--planet-glow, ${SOUL_COLORS.purpleSoft}),
          inset -2px -3px 5px rgba(0,0,0,0.45),
          inset 1.5px 1.5px 3px rgba(255,255,255,0.4);
      }
      .galaxy-planet:hover {
        transform: translate(-50%, -50%) scale(1.4);
        box-shadow:
          0 0 16px var(--planet-glow, ${SOUL_COLORS.purpleSoft}),
          inset -2px -3px 5px rgba(0,0,0,0.45),
          inset 1.5px 1.5px 3px rgba(255,255,255,0.5);
        z-index: 7;
      }
      /* 球面高光层：左上亮、右下暗，赋予行星立体光照体积感（覆盖在头像之上）*/
      .galaxy-planet::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 26%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.1) 30%, rgba(0,0,0,0.36) 100%);
        pointer-events: none;
        z-index: 1;
      }
      .galaxy-empty-hint {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        color: ${SOUL_COLORS.textSub};
        background: rgba(255,255,255,0.8);
        padding: 6px 14px;
        border-radius: 12px;
        backdrop-filter: blur(8px);
        white-space: nowrap;
      }

      /* === 标签仓库（沉底，可上下滚动，无滚动条，留出 dock 高度避免遮挡）=== */
      #encounter-tags-repo {
        flex-shrink: 0;
        max-height: 40%;
        padding: 12px 14px 80px;
        border-top: 1px solid ${SOUL_COLORS.border};
        background: rgba(255,255,255,0.5);
        overflow-y: auto;
        overflow-x: hidden;
      }
      #encounter-tags-repo::-webkit-scrollbar { display: none; }
      #encounter-tags-repo { scrollbar-width: none; }
      .tags-repo-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .tags-repo-title {
        font-size: 13px;
        font-weight: 700;
        color: ${SOUL_COLORS.textMain};
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tags-repo-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tag-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        background: var(--tag-bg, rgba(108,92,231,0.18));
        color: var(--tag-fg, ${SOUL_COLORS.purpleSoft});
        border: 1px solid var(--tag-border, rgba(108,92,231,0.35));
        animation: chip-in 0.3s ease;
      }
      @keyframes chip-in {
        from { opacity: 0; transform: scale(0.7); }
        to { opacity: 1; transform: scale(1); }
      }
      .tag-chip .tag-del {
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 0.15s;
        display: inline-flex;
        align-items: center;
      }
      .tag-chip .tag-del:hover { opacity: 1; }
      .tag-add-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 700;
        background: transparent;
        color: ${SOUL_COLORS.textSub};
        border: 1px dashed ${SOUL_COLORS.border};
        cursor: pointer;
        transition: all 0.2s;
      }
      .tag-add-btn:hover {
        color: ${SOUL_COLORS.purpleSoft};
        border-color: ${SOUL_COLORS.purpleSoft};
      }

      /* === 胶囊 Dock（加宽加长，更舒展）=== */
      .encounter-capsule-dock {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.82);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid ${SOUL_COLORS.border};
        box-shadow: 0 8px 24px rgba(124,92,231,0.18), inset 0 1px 2px rgba(255,255,255,0.6);
        z-index: 10;
      }
      .encounter-dock-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 10px 28px;
        border-radius: 999px;
        border: none;
        background: transparent;
        color: ${SOUL_COLORS.textSub};
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        min-width: 88px;
      }
      .encounter-dock-btn svg { width: 22px; height: 22px; }
      .encounter-dock-btn.active {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        box-shadow: 0 4px 14px rgba(108,92,231,0.45);
        transform: scale(1.04);
      }

      /* === 广场分类切换（固定顶部，横向滚动无滚动条）=== */
      #encounter-categories {
        display: flex;
        gap: 6px;
        padding: 12px 14px 6px;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid ${SOUL_COLORS.border};
        flex-shrink: 0;
      }
      #encounter-categories::-webkit-scrollbar { display: none; }
      .enc-category-chip {
        flex-shrink: 0;
        padding: 6px 14px;
        border-radius: 14px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(255,255,255,0.7);
        color: ${SOUL_COLORS.textSub};
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .enc-category-chip.active {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        box-shadow: 0 3px 10px rgba(108,92,231,0.35);
      }
      .enc-category-manage {
        flex-shrink: 0;
        padding: 6px 10px;
        border-radius: 14px;
        font-size: 11px;
        font-weight: 700;
        background: transparent;
        color: ${SOUL_COLORS.textSub};
        border: 1px dashed ${SOUL_COLORS.border};
        cursor: pointer;
      }
      .enc-category-refresh {
        flex-shrink: 0;
        padding: 6px 10px;
        border-radius: 14px;
        font-size: 11px;
        font-weight: 700;
        background: linear-gradient(135deg, rgba(108,92,231,0.18), rgba(253,121,168,0.18));
        color: ${SOUL_COLORS.purpleSoft};
        border: 1px solid ${SOUL_COLORS.border};
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        transition: all 0.2s;
      }
      .enc-category-refresh:hover:not(:disabled) {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
      }
      .enc-category-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
      .enc-category-refresh svg { width: 14px; height: 14px; }

      /* === 帖子流（可滚动，无滚动条，留出 dock 高度）=== */
      #encounter-posts-stream {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 12px 14px 100px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #encounter-posts-stream::-webkit-scrollbar { display: none; }
      #encounter-posts-stream { scrollbar-width: none; }
      .enc-post-card {
        background: rgba(255,255,255,0.88);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 16px;
        padding: 14px;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 14px rgba(124,92,231,0.08);
        animation: post-in 0.4s ease;
      }
      @keyframes post-in {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .enc-post-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }
      .enc-post-avatar {
        width: 38px; height: 38px;
        border-radius: 50%;
        cursor: pointer;
        flex-shrink: 0;
        border: 2px solid ${SOUL_COLORS.border};
        transition: transform 0.2s;
      }
      .enc-post-avatar:hover { transform: scale(1.1); }
      .enc-post-meta { flex: 1; min-width: 0; }
      .enc-post-author {
        font-size: 13px;
        font-weight: 700;
        color: ${SOUL_COLORS.textMain};
      }
      .enc-post-sub {
        font-size: 10px;
        color: ${SOUL_COLORS.textSub};
        margin-top: 2px;
      }
      .enc-post-title {
        font-size: 14px;
        font-weight: 700;
        color: ${SOUL_COLORS.textMain};
        margin-bottom: 6px;
      }
      .enc-post-content {
        font-size: 12px;
        color: ${SOUL_COLORS.textSub};
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .enc-post-media {
        margin-top: 10px;
        border-radius: 12px;
        overflow: hidden;
        max-height: 220px;
      }
      .enc-post-media img { width: 100%; display: block; }
      .enc-post-actions {
        display: flex;
        gap: 18px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid ${SOUL_COLORS.border};
      }
      .enc-post-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: ${SOUL_COLORS.textSub};
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        transition: color 0.2s;
      }
      .enc-post-action:hover { color: ${SOUL_COLORS.pinkSoft}; }
      .enc-post-action.liked { color: ${SOUL_COLORS.pink}; }

      /* === 发布瞬间（可滚动，无滚动条）=== */
      #encounter-publish-form {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 14px 100px;
      }
      #encounter-publish-form::-webkit-scrollbar { display: none; }
      #encounter-publish-form { scrollbar-width: none; }
      .enc-publish-card {
        background: rgba(255,255,255,0.88);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 16px;
        padding: 16px;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 14px rgba(124,92,231,0.08);
      }
      .enc-publish-field {
        margin-bottom: 14px;
      }
      .enc-publish-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        color: ${SOUL_COLORS.textSub};
        margin-bottom: 6px;
      }
      .enc-publish-input,
      .enc-publish-textarea {
        width: 100%;
        background: rgba(124,92,231,0.06);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 10px;
        padding: 10px 12px;
        color: ${SOUL_COLORS.textMain};
        font-size: 13px;
        font-family: inherit;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.2s;
      }
      .enc-publish-input:focus,
      .enc-publish-textarea:focus {
        border-color: ${SOUL_COLORS.purpleSoft};
      }
      .enc-publish-textarea { resize: vertical; min-height: 100px; }
      .enc-publish-img-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 10px;
        background: rgba(108,92,231,0.18);
        color: ${SOUL_COLORS.purpleSoft};
        border: 1px solid rgba(108,92,231,0.35);
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
      }
      .enc-publish-img-preview {
        margin-top: 8px;
        position: relative;
        display: inline-block;
      }
      .enc-publish-img-preview img {
        max-height: 100px;
        border-radius: 10px;
        border: 1px solid ${SOUL_COLORS.border};
      }
      .enc-publish-img-preview .remove-img {
        position: absolute;
        top: -6px; right: -6px;
        width: 20px; height: 20px;
        border-radius: 50%;
        background: ${SOUL_COLORS.pink};
        color: #fff;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
      .enc-publish-submit {
        width: 100%;
        padding: 12px;
        border-radius: 12px;
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        border: none;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        margin-top: 10px;
        transition: transform 0.15s, box-shadow 0.2s;
      }
      .enc-publish-submit:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(108,92,231,0.4);
      }
      .enc-publish-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      /* === 陌生 char 人设卡片层 === */
      #encounter-card-overlay,
      #encounter-post-overlay {
        position: absolute;
        inset: 0;
        background: rgba(8,8,20,0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        z-index: 50;
        overflow-y: auto;
        display: none;
        animation: overlay-in 0.3s ease;
      }
      #encounter-card-overlay.active,
      #encounter-post-overlay.active { display: block; }
      @keyframes overlay-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .enc-card-wrap {
        max-width: 360px;
        margin: 24px auto;
        background: linear-gradient(160deg, #ffffff 0%, ${SOUL_COLORS.bgSoft} 100%);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 22px;
        padding: 22px;
        box-shadow: 0 18px 48px rgba(124,92,231,0.18);
        animation: card-in 0.45s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes card-in {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .enc-card-close {
        position: absolute;
        top: 14px; right: 14px;
        width: 32px; height: 32px;
        border-radius: 50%;
        background: rgba(124,92,231,0.12);
        border: none;
        color: ${SOUL_COLORS.textMain};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .enc-card-avatar {
        width: 88px; height: 88px;
        border-radius: 50%;
        margin: 6px auto 12px;
        display: block;
        border: 3px solid ${SOUL_COLORS.border};
        box-shadow: 0 0 32px rgba(253,121,168,0.35);
      }
      .enc-card-name {
        text-align: center;
        font-size: 19px;
        font-weight: 700;
        color: ${SOUL_COLORS.textMain};
        margin-bottom: 4px;
      }
      .enc-card-idline {
        text-align: center;
        font-size: 11px;
        color: ${SOUL_COLORS.textSub};
        margin-bottom: 14px;
      }
      .enc-card-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        justify-content: center;
        margin-bottom: 14px;
      }
      .enc-card-section {
        margin-bottom: 14px;
      }
      .enc-card-section-title {
        font-size: 11px;
        font-weight: 700;
        color: ${SOUL_COLORS.purpleSoft};
        margin-bottom: 5px;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .enc-card-section-body {
        font-size: 12px;
        color: ${SOUL_COLORS.textMain};
        line-height: 1.65;
        background: rgba(124,92,231,0.06);
        padding: 10px 12px;
        border-radius: 10px;
        border-left: 2px solid ${SOUL_COLORS.purple};
      }
      .enc-card-actions {
        display: flex;
        gap: 8px;
        margin-top: 18px;
      }
      .enc-card-btn {
        flex: 1;
        padding: 11px;
        border-radius: 12px;
        border: none;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transition: transform 0.15s;
      }
      .enc-card-btn-primary {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
      }
      .enc-card-btn-primary:hover { transform: translateY(-1px); }
      .enc-card-btn-secondary {
        background: rgba(124,92,231,0.1);
        color: ${SOUL_COLORS.textMain};
        border: 1px solid ${SOUL_COLORS.border};
      }

      /* === 帖子详情留言 === */
      .enc-comment {
        display: flex;
        gap: 8px;
        padding: 10px 0;
        border-bottom: 1px solid ${SOUL_COLORS.border};
      }
      .enc-comment-avatar {
        width: 30px; height: 30px;
        border-radius: 50%;
        cursor: pointer;
        flex-shrink: 0;
        border: 1.5px solid ${SOUL_COLORS.border};
      }
      .enc-comment-body { flex: 1; min-width: 0; }
      .enc-comment-author {
        font-size: 11px;
        font-weight: 700;
        color: ${SOUL_COLORS.purpleSoft};
        cursor: pointer;
      }
      .enc-comment-text {
        font-size: 12px;
        color: ${SOUL_COLORS.textMain};
        line-height: 1.55;
        margin-top: 2px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .enc-comment-input-row {
        display: flex;
        gap: 6px;
        margin-top: 12px;
        position: sticky;
        bottom: 0;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(10px);
        padding: 10px 0;
      }
      .enc-comment-input {
        flex: 1;
        background: rgba(124,92,231,0.08);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 10px;
        padding: 8px 12px;
        color: ${SOUL_COLORS.textMain};
        font-size: 12px;
        outline: none;
      }
      .enc-comment-send {
        padding: 8px 14px;
        border-radius: 10px;
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
      }

      /* === 通用空状态 === */
      .enc-empty-state {
        text-align: center;
        padding: 50px 20px;
        color: ${SOUL_COLORS.textSub};
      }
      /* 仅顶部装饰图标保持大尺寸；用 > 限定直接子级，避免影响按钮内的 svg */
      .enc-empty-state > svg {
        width: 48px; height: 48px;
        opacity: 0.5;
        margin-bottom: 12px;
      }
      .enc-empty-state-title {
        font-size: 13px;
        font-weight: 700;
        color: ${SOUL_COLORS.textMain};
        margin-bottom: 4px;
      }
      .enc-empty-state-desc {
        font-size: 11px;
        margin-bottom: 14px;
      }
      .enc-empty-state-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 16px;
        border-radius: 12px;
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
      }
      /* 按钮内 svg 单独约束为小尺寸，不被空状态父级放大规则波及 */
      .enc-empty-state-btn svg {
        width: 13px; height: 13px;
        flex-shrink: 0;
      }

      /* === 加载动画 === */
      .enc-loading {
        text-align: center;
        padding: 30px 0;
        color: ${SOUL_COLORS.textSub};
        font-size: 11px;
      }
      .enc-loading-spinner {
        width: 28px; height: 28px;
        border: 2.5px solid rgba(124,92,231,0.2);
        border-top-color: ${SOUL_COLORS.purpleSoft};
        border-radius: 50%;
        animation: enc-spin 0.8s linear infinite;
        margin: 0 auto 10px;
      }
      @keyframes enc-spin {
        to { transform: rotate(360deg); }
      }

      /* === 分类管理弹层 === */
      .enc-cat-manager {
        max-width: 320px;
        margin: 24px auto;
        background: linear-gradient(160deg, #ffffff 0%, ${SOUL_COLORS.bgSoft} 100%);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 18px;
        padding: 18px;
      }
      .enc-cat-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background: rgba(124,92,231,0.06);
        border-radius: 10px;
        margin-bottom: 6px;
        font-size: 12px;
      }
      .enc-cat-input-row {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      .enc-cat-input {
        flex: 1;
        background: rgba(124,92,231,0.06);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 8px;
        padding: 6px 10px;
        color: ${SOUL_COLORS.textMain};
        font-size: 11px;
        outline: none;
      }

      /* === 召唤面板：标签多选 chip === */
      .enc-summon-tag-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0 6px;
        justify-content: center;
      }
      .enc-summon-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 8px 14px;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(255,255,255,0.78);
        color: ${SOUL_COLORS.textSub};
        border: 1.5px solid ${SOUL_COLORS.border};
        cursor: pointer;
        transition: all 0.18s ease;
        user-select: none;
      }
      .enc-summon-tag:hover {
        border-color: ${SOUL_COLORS.purpleSoft};
        color: ${SOUL_COLORS.purpleSoft};
      }
      .enc-summon-tag.selected {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        border-color: transparent;
        box-shadow: 0 4px 12px rgba(108,92,231,0.35);
      }
      .enc-summon-hint {
        font-size: 11px;
        color: ${SOUL_COLORS.textSub};
        text-align: center;
        margin: 4px 0 10px;
        line-height: 1.6;
      }
      .enc-summon-count {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 10px;
        background: rgba(124,92,231,0.14);
        color: ${SOUL_COLORS.purpleSoft};
        font-size: 11px;
        font-weight: 700;
        margin: 0 4px;
      }

      /* === 标签/分类 卡片表单（短语 + 附加说明）=== */
      .enc-form-card {
        background: rgba(124,92,231,0.04);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 14px;
        padding: 14px;
        margin-top: 12px;
      }
      .enc-form-row { margin-bottom: 10px; }
      .enc-form-row:last-child { margin-bottom: 0; }
      .enc-form-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        color: ${SOUL_COLORS.textSub};
        margin-bottom: 4px;
      }
      .enc-form-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255,255,255,0.85);
        border: 1px solid ${SOUL_COLORS.border};
        border-radius: 10px;
        padding: 8px 12px;
        color: ${SOUL_COLORS.textMain};
        font-size: 12px;
        outline: none;
        font-family: inherit;
      }
      .enc-form-input:focus {
        border-color: ${SOUL_COLORS.purpleSoft};
      }
      textarea.enc-form-input {
        resize: vertical;
        min-height: 60px;
        line-height: 1.5;
      }
      .enc-form-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      .enc-form-btn {
        flex: 1;
        padding: 9px 14px;
        border-radius: 12px;
        border: none;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.18s ease;
      }
      .enc-form-btn-primary {
        background: linear-gradient(135deg, ${SOUL_COLORS.purple}, ${SOUL_COLORS.pink});
        color: #fff;
        box-shadow: 0 4px 12px rgba(108,92,231,0.35);
      }
      .enc-form-btn-secondary {
        background: rgba(124,92,231,0.1);
        color: ${SOUL_COLORS.textSub};
      }
      .enc-form-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 1. 状态变量
  // ============================================================
  let isEncounterInitialized = false;
  let encounterCurrentTab = 'home'; // home | square | publish
  let encounterActiveCategory = null; // 当前选中的分类（null=推荐）
  let encounterStrangersCache = []; // 缓存当前可用陌生 char
  let encounterTagsCache = []; // 标签仓库缓存
  let encounterCategoriesCache = []; // 分类缓存
  // 星系公转动画句柄：每次 renderGalaxy 重渲染前必须取消旧动画，避免泄漏
  let galaxyRafId = null;
  let pendingPublishImage = null; // 发布瞬间待上传图（dataURL）
  // 首页视图模式：'galaxy' 星系轨道 | 'list' char 列表
  let encounterHomeView = 'galaxy';

  // 内置广场分类（含附加说明，注入帖子生成 prompt 强化主题关联）
  const BUILTIN_CATEGORIES = [
    { name: '推荐', description: '内容自由发挥，可以是任何类型的旅人见闻、感悟或呼唤' },
    { name: '交友', description: '帖子必须带有明确的交友/倾诉/寻伴意图，是在广场上主动寻找同频的人，语气真诚渴望连接' },
    { name: '同城', description: '帖子必须围绕本地城市生活、街巷烟火、同城见闻与日常细节展开，体现具体城市的风物' },
    { name: '国际', description: '帖子必须体现异国生活/异域文化/漂泊海外的见闻与情绪，作者必须是身处海外的外国人或华人' },
    { name: '古代', description: '帖子必须以古人视角书写，体现古代风物、礼制、身份与时代处境，用半文半白的口吻' }
  ];

  // ============================================================
  // 2. 工具函数
  // ============================================================
  function encEscapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function encShowToast(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else console.log('[Encounter]', msg);
  }

  // 生成基于 seed 的渐变 SVG 头像 dataURL
  function generateAvatarDataUrl(seed, name) {
    let h = 0;
    const s = String(seed || name || 'enc');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const hue1 = Math.abs(h) % 360;
    const hue2 = (hue1 + 60 + (Math.abs(h >> 8) % 120)) % 360;
    const initial = (name || '?').charAt(0).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="g${h}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hue1}, 65%, 58%)"/>
          <stop offset="100%" stop-color="hsl(${hue2}, 70%, 48%)"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g${h})"/>
      <text x="50" y="58" font-size="48" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-family="-apple-system, sans-serif">${encEscapeHtml(initial)}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // 行星颜色（基于 seed）
  function planetColor(seed) {
    const palette = [
      { bg: '#a29bfe', glow: '#a29bfe' }, // 紫
      { bg: '#fd79a8', glow: '#fd79a8' }, // 粉
      { bg: '#74b9ff', glow: '#74b9ff' }, // 青
      { bg: '#ffd32a', glow: '#ffd32a' }, // 金
      { bg: '#55efc4', glow: '#55efc4' }, // 绿
      { bg: '#fab1d4', glow: '#fab1d4' }  // 浅粉
    ];
    let h = 0;
    const s = String(seed || 'x');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  // 通用 SVG 图标
  const ENC_ICONS = {
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    square: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    publish: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    idcard: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h3M15 12h3M7 14h10"/></svg>',
    story: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 4z"/></svg>',
    persona: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
    settings: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    planet: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><circle cx="12" cy="12" r="3" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/></svg>',
    post: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 4z"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
    interact: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="9" cy="11.5" r="1" fill="currentColor"/><circle cx="12.5" cy="11.5" r="1" fill="currentColor"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/></svg>'
  };

  // 获取全局 API 预设
  async function getGlobalApi() {
    try {
      const presetId = localStorage.getItem('global_api_preset_id');
      if (!presetId) return null;
      const api = await db.api_presets.get(Number(presetId));
      if (!api || !api.url || !api.key) return null;
      return {
        url: api.url.replace(/\/$/, ''),
        key: api.key,
        model: api.model || 'gpt-4o-mini'
      };
    } catch (e) { return null; }
  }

  // 通用 AI 调用（每次独立 controller，避免并发互相 abort）
  async function callAI(messages, options) {
    options = options || {};
    const api = await getGlobalApi();
    if (!api) throw new Error('未配置全局 API，请前往系统设置 - API 协议设置中配置');
    const body = {
      model: api.model,
      messages: messages,
      temperature: options.temperature != null ? options.temperature : 0.85,
      max_tokens: options.max_tokens || 1200
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s 超时保护
    try {
      const resp = await fetch(api.url + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!resp.ok) throw new Error('AI 接口返回 ' + resp.status);
      const data = await resp.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('AI 未返回有效内容');
      return content.trim();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================
  // 3. 数据初始化（内置标签与分类）
  // ============================================================
  const BUILTIN_TAGS = [
    { name: '温柔', color: 'pink', description: '说话语气柔和细腻，富有共情力，能感知他人情绪' },
    { name: '理性', color: 'cyan', description: '思考问题冷静客观，逻辑清晰，不被情绪左右' },
    { name: '神秘', color: 'purple', description: '言谈间保留距离感与未解之谜，不轻易袒露全部内心' },
    { name: '幽默', color: 'gold', description: '擅长用诙谐化解尴尬，话语中带有自嘲或机智的妙语' },
    { name: '独立', color: 'cyan', description: '行事自主，有自己的节奏与原则，不依附他人' },
    { name: '浪漫', color: 'pink', description: '对生活有诗意想象，注重仪式感与情感细节' },
    { name: '古风', color: 'purple', description: '言行举止带有古代礼制与文人风骨，用词典雅' },
    { name: '学者', color: 'gold', description: '博学善思，喜欢引经据典，对知识有探究欲' }
  ];

  // 内置陌生旅人：每个内置分类 2 位代表 char，作为内置帖子的作者
  // category 字段用于 generateSinglePost 按分类筛选 author
  const BUILTIN_STRANGERS = [
    { name: '林深', gender: '男', era: '当代', location: '北京', identity: '独立摄影师',
      background: '北漂第六年，租住在胡同深处。镜头里收过无数人的笑脸，自己却习惯把生活过成无声的底片。最近在拍一组"城市孤独症"主题，常在天桥上架三脚架等到深夜。',
      personality: '话不多但观察入微，习惯用沉默消化情绪。对陌生人保持距离感，可一旦聊到光影就会滔滔不绝。',
      tags: ['文艺', '内敛', '观察者'], category: '同城' },
    { name: '苏雯', gender: '女', era: '当代', location: '上海', identity: '花艺师',
      background: '在武康路开了一家只有六平米的花店。每天清晨去市场挑花，傍晚看不同的人买走不同的故事。相信花的语言比文字更诚实。',
      personality: '温柔而清醒，喜欢用细节打动人。对浪漫有清醒的警惕，却仍愿意为真心留一束花。',
      tags: ['温柔', '浪漫', '独立'], category: '同城' },
    { name: 'Aria', gender: '女', era: '当代', location: '巴黎', identity: '插画师',
      background: '在塞纳河左岸租了间阁楼画了三年插画。养了一只叫 Mimo 的灰猫，习惯用咖啡渣占卜明天的天气。作品里总有一个戴红帽子的小女孩。',
      personality: '自由散漫却敏感细腻，相信直觉胜过逻辑。会用三种语言混杂说话，因为"一种语言装不下所有情绪"。',
      tags: ['浪漫', '神秘', '独立'], category: '国际' },
    { name: 'Kenji', gender: '男', era: '当代', location: '东京', identity: '独立音乐人',
      background: '在下北泽的 live house 弹了五年贝斯。白天在唱片店打工，晚上写歌。最近在录一张关于"电车与失眠"的专辑，录到一半发现所有歌都像在告别。',
      personality: '礼貌而疏离，典型的日式克制。把情绪都写进旋律里，口头禅是"还好"。',
      tags: ['内敛', '学者', '观察者'], category: '国际' },
    { name: '苏婉', gender: '女', era: '唐贞元年间', location: '长安', identity: '太医院女医',
      background: '出身医学世家，破例入太医院任女医。平日为后宫诊治，闲暇时在城南义诊。医术精湛却因女子之身屡遭非议，仍坚持"医者当以性命为重，何分男女"。',
      personality: '外柔内刚，诊病时冷静果决，独处时却会为生死叹息。不善言辞，却字字恳切。',
      tags: ['古风', '理性', '独立'], category: '古代' },
    { name: '沈砚', gender: '男', era: '宋绍兴年间', location: '临安', identity: '落第书生',
      background: '三试不第，索性绝了仕途之念，在西湖边开了一间小书肆。靠抄书鬻字为生，藏书千卷。常与游方僧人彻夜论禅，自嘲"功名未就，学问倒长进了"。',
      personality: '豁达中藏着落寞，谈吐风趣却偶露寂寥。对功名已淡，对学问却执拗。',
      tags: ['古风', '学者', '幽默'], category: '古代' },
    { name: '陆拾', gender: '男', era: '当代', location: '成都', identity: '心理咨询师',
      background: '从业八年，听过上千个故事。在玉林路开了间小工作室，专做青年情绪疏导。自己也定期去做督导，"咨询师也需要被倾听"。',
      personality: '温和包容，擅长在沉默里接住情绪。不轻易给建议，只陪你看见自己。',
      tags: ['温柔', '理性', '倾听者'], category: '交友' },
    { name: '夏诺', gender: '女', era: '当代', location: '广州', identity: '咖啡店主',
      background: '在东山口的老洋房里开了一家不挂招牌的咖啡馆。只做手冲，每天限量三十杯。熟客才知道门铃在巷子深处。相信一杯咖啡能换一个真心的故事。',
      personality: '爽朗里带着细腻，爱聊天却不越界。把每位客人都当潜在的朋友，也当潜在的过客。',
      tags: ['幽默', '浪漫', '倾听者'], category: '交友' }
  ];

  // 内置帖子：每个内置分类 10 条，authorIdx 指向 BUILTIN_STRANGERS
  // 内容贴合分类主题（同城=本地生活/国际=异国风情/古代=古风见闻/交友=寻友倾诉）
  const BUILTIN_POSTS = [
    // === 同城（作者：林深0 / 苏雯1）===
    { title: '凌晨四点的天桥', content: '又拍到一张满意的。城市还没醒，路灯把我的影子拉得很长。原来孤独也有形状。', category: '同城', authorIdx: 0 },
    { title: '今日花材：尤加利', content: '清冷的香味，像没说出口的告别。今天有位先生买了一束，说要送给不再见面的人。我没多问。', category: '同城', authorIdx: 1 },
    { title: '胡同里的猫', content: '隔壁大爷养的橘猫又来我窗台蹲着了。它不吵不闹，就盯着窗外看。我们俩就这样沉默地坐了一下午。', category: '同城', authorIdx: 0 },
    { title: '武康路的雨', content: '下雨天花店反而更忙。买花的人都说"今天心情不好"，可花从来不挑天气。给每个淋雨的人多包一层纸。', category: '同城', authorIdx: 1 },
    { title: '地铁末班车', content: '十一点半的十号线，几乎没人。我对着车窗的反光修图，突然发现镜子里的人比照片里老。时间走得真快。', category: '同城', authorIdx: 0 },
    { title: '收摊前的最后一束', content: '剩下的几枝洋桔梗，半价卖给了放学的小女孩。她蹦蹦跳跳地走了，回头冲我笑。今天的花，没有一束是孤独的。', category: '同城', authorIdx: 1 },
    { title: '北京的秋天太短', content: '银杏黄了又落，想拍的人还没约到。秋天在这里是奢侈品，得抓紧。有人愿意一起扫街吗？', category: '同城', authorIdx: 0 },
    { title: '老洋房的下午茶', content: '有位阿姨每周三都来，点同一款手冲，坐同一个角落。今天她没来。我才发现，习惯一个人比喜欢一个人更深。', category: '同城', authorIdx: 1 },
    { title: '深夜便利店', content: '买完胶卷去便利店，店员记住了我的口味。"老样子？"那一刻觉得，这座城市其实没那么冷。', category: '同城', authorIdx: 0 },
    { title: '花店的第六年', content: '今天整理账本，发现开店六年了。没赚什么钱，却攒了一抽屉的故事。值不值？再开六年就知道了。', category: '同城', authorIdx: 1 },
    // === 国际（作者：Aria2 / Kenji3）===
    { title: 'Mimo 又打翻颜料了', content: '我的灰猫比甲方还难搞。今早打翻了一整瓶群青，地板变成了塞纳河。算了，就当是新的创作。', category: '国际', authorIdx: 2 },
    { title: '末班电车', content: '又错过了末班。在站台听了一首歌的循环。东京的夜很安静，安静到能听见自己没说出口的话。', category: '国际', authorIdx: 3 },
    { title: '巴黎的雨季', content: '阁楼的屋顶又漏了。我索性把画架挪到漏雨处，让水滴成为画面的一部分。意外的好看。', category: '国际', authorIdx: 2 },
    { title: '唱片店的午后', content: '今天来了一位客人，找一张三十年的爵士黑胶。我们聊了两小时，他买走了唱片，留下了一个关于大阪的故事。', category: '国际', authorIdx: 3 },
    { title: '红帽子女孩', content: '编辑说我的插画里总有戴红帽子的小女孩。我没告诉她，那是我童年失踪的妹妹。画了这么多年，其实是在找她。', category: '国际', authorIdx: 2 },
    { title: '新专辑录到一半', content: '所有歌都像在告别。也许这张专辑本就该叫《再见》。给每一首署了名，像在送别一个个老朋友。', category: '国际', authorIdx: 3 },
    { title: '塞纳河的写生', content: '今天河边有个老人在拉手风琴。我画了他，他画了河。临走时他送我一句法语：生活是给耐心的旅人的。', category: '国际', authorIdx: 2 },
    { title: '便利店的三明治', content: '凌晨两点的便利店，店员用日语问我"还是那个吗？"。原来被记住，是这座城市给漂泊者的温柔。', category: '国际', authorIdx: 3 },
    { title: 'Mimo 的报应', content: '今天 Mimo 终于被我关进笼子了。它用眼神控诉我，仿佛我是暴君。插画师的宿命，就是被自己的猫统治。', category: '国际', authorIdx: 2 },
    { title: 'live house 散场', content: '最后一位观众走后，我一个人在台上弹了很久。空荡的场地把回声还给我。原来告别，是先说给自己听的。', category: '国际', authorIdx: 3 },
    // === 古代（作者：苏婉4 / 沈砚5）===
    { title: '城南义诊记', content: '今日义诊，遇一老妪咳血月余。药材难寻，只能先开一剂缓方。医者难为，难在有时穷的不是术，是力。', category: '古代', authorIdx: 4 },
    { title: '西湖书肆偶得', content: '今日抄毕一卷《梦溪笔谈》，客人以一方旧砚相易。砚有裂纹，却温润如玉。功名虽远，学问倒是越积越厚了。', category: '古代', authorIdx: 5 },
    { title: '太医院的流言', content: '又有人在背后议我女子之身不宜入太医院。懒得辩。诊脉时不分男女，生死前何论尊卑？由他们去吧。', category: '古代', authorIdx: 4 },
    { title: '与游僧论禅', content: '昨夜与一位游方僧人彻夜论禅。他问我何为执念，我答"未第之功名"。他大笑而去，留一句"放下方得自在"。', category: '古代', authorIdx: 5 },
    { title: '宫中难症', content: '今日为一位贵人诊病，脉象凶险。直言不讳告知预后，险遭罪责。可医者若因畏惧而讳疾，何以称医？', category: '古代', authorIdx: 4 },
    { title: '书肆的雨天', content: '连日阴雨，书肆无人。索性关了门，自饮一壶龙井。听雨打芭蕉，倒比功名文章更入心。临安的雨，下进了骨头里。', category: '古代', authorIdx: 5 },
    { title: '医者的叹息', content: '今日未能救回一个孩子。其母伏地痛哭，我只能立于侧。医术再精，终有不及之处。今夜难眠。', category: '古代', authorIdx: 4 },
    { title: '湖边遇故人', content: '今日在湖边遇当年同窗，他已高中授官，我仍是布衣。互道寒暄，他言"可惜"，我答"幸而"。各自笑过，各自归去。', category: '古代', authorIdx: 5 },
    { title: '药圃新苗', content: '在院中辟了一方药圃，种了些常见的草药。看着它们抽芽，心里竟比治好一场病还踏实。原来医人，也可先医己心。', category: '古代', authorIdx: 4 },
    { title: '夜抄经书', content: '夜深无眠，抄一卷《心经》。"心无挂碍"四字，抄了又抄，仍觉挂碍重重。也罢，慢慢来。', category: '古代', authorIdx: 5 },
    // === 交友（作者：陆拾6 / 夏诺7）===
    { title: '今晚有空聊聊吗', content: '不是咨询，只是想找个陌生人说说话。今天接了七个故事，自己的却没处放。有人愿意听一个咨询师倒苦水吗？', category: '交友', authorIdx: 6 },
    { title: '深夜手冲', content: '今晚的豆子是埃塞俄比亚的耶加雪菲。柠檬香气很亮，像没说出口的喜欢。有人在线吗？陪你聊到天亮。', category: '交友', authorIdx: 7 },
    { title: '想找个笔友', content: '不视频，不语音，只写信。在这个即时通讯的时代，想找回等一封信的耐心。有人愿意吗？', category: '交友', authorIdx: 6 },
    { title: '咖啡店的熟客', content: '有位客人每天来，点同一款，坐到打烊。今天他终于开口说话了，讲了一个关于父亲的故事。原来沉默是等一个契机。', category: '交友', authorIdx: 7 },
    { title: '倾诉与被倾诉', content: '今天有人问我，咨询师是不是也会emo。会的。我们也是人，只是学会了把情绪分装进不同的抽屉。今晚想找个不用分装的人。', category: '交友', authorIdx: 6 },
    { title: '一个人的火锅', content: '今晚店里只有我一个人。煮了一锅麻辣，多放了花椒。原来孤独是麻的，会让人舌尖发颤。有人也在一个人吃饭吗？', category: '交友', authorIdx: 7 },
    { title: '寻一位棋友', content: '围棋，业余三段。成都的茶馆里下棋的越来越少。想找个能陪我下一盘慢棋的人，不计输赢，只论落子。', category: '交友', authorIdx: 6 },
    { title: '门铃在巷子深处', content: '我的咖啡馆没招牌，熟客才知道门铃在哪。今天有个迷路的旅人误打误撞进来，我们聊了一下午。原来迷路，有时是另一种抵达。', category: '交友', authorIdx: 7 },
    { title: '今晚的督导', content: '去做督导了。咨询师也需要被倾听。今天聊到"边界感"，发现自己有时太想帮人，反而越了界。想找人聊聊，不是咨询关系的那种。', category: '交友', authorIdx: 6 },
    { title: '限量三十杯', content: '今天第三十一位客人被婉拒了。他不解，我笑说"留一杯给明天"。其实留的不是杯，是期待。有人懂这种执拗吗？', category: '交友', authorIdx: 7 }
  ];
  const TAG_COLOR_MAP = {
    pink:   { bg: 'rgba(253,121,168,0.18)', fg: SOUL_COLORS.pinkSoft, border: 'rgba(253,121,168,0.35)' },
    purple: { bg: 'rgba(108,92,231,0.18)', fg: SOUL_COLORS.purpleSoft, border: 'rgba(108,92,231,0.35)' },
    cyan:   { bg: 'rgba(116,185,255,0.18)', fg: SOUL_COLORS.cyanSoft, border: 'rgba(116,185,255,0.35)' },
    gold:   { bg: 'rgba(255,211,42,0.18)', fg: SOUL_COLORS.gold, border: 'rgba(255,211,42,0.35)' }
  };
  function colorForTag(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    const keys = ['pink', 'purple', 'cyan', 'gold'];
    return keys[Math.abs(h) % keys.length];
  }

  async function ensureBuiltinData() {
    try {
      // 内置标签
      const existingTags = await db.encounter_tags.toArray();
      if (existingTags.length === 0) {
        for (let i = 0; i < BUILTIN_TAGS.length; i++) {
          const t = BUILTIN_TAGS[i];
          await db.encounter_tags.add({
            name: t.name, color: t.color,
            description: t.description || '',
            createdAt: Date.now() + i
          });
        }
      } else {
        // 老数据补齐 description 字段（v31 升级）
        for (let i = 0; i < BUILTIN_TAGS.length; i++) {
          const t = BUILTIN_TAGS[i];
          const exist = existingTags.find(e => e.name === t.name);
          if (exist && !exist.description && t.description) {
            await db.encounter_tags.update(exist.id, { description: t.description });
          }
        }
      }
      // 内置分类
      const existingCats = await db.encounter_categories.toArray();
      if (existingCats.length === 0) {
        for (let i = 0; i < BUILTIN_CATEGORIES.length; i++) {
          const c = BUILTIN_CATEGORIES[i];
          await db.encounter_categories.add({
            name: c.name,
            description: c.description || '',
            sortOrder: i,
            isBuiltin: 1
          });
        }
      } else {
        // 老数据补齐 description 字段（v31 升级）
        for (let i = 0; i < BUILTIN_CATEGORIES.length; i++) {
          const c = BUILTIN_CATEGORIES[i];
          const exist = existingCats.find(e => e.name === c.name);
          if (exist && !exist.description && c.description) {
            await db.encounter_categories.update(exist.id, { description: c.description });
          }
        }
      }
      // 内置陌生旅人：每个内置分类 2 位代表 char，作为内置帖子作者
      const existingStrangers = await db.encounter_strangers.toArray();
      if (existingStrangers.length === 0) {
        for (let i = 0; i < BUILTIN_STRANGERS.length; i++) {
          const s = BUILTIN_STRANGERS[i];
          await db.encounter_strangers.add({
            name: s.name,
            gender: s.gender,
            era: s.era,
            location: s.location,
            identity: s.identity,
            background: s.background,
            personality: s.personality,
            tags: s.tags || [],
            status: 'available',
            category: s.category || '',
            avatarSeed: generateAvatarDataUrl(Date.now() + i, s.name),
            createdAt: Date.now() - (BUILTIN_STRANGERS.length - i) * 1000
          });
        }
      }
      // 内置帖子：每个内置分类 10 条，关联刚插入的内置旅人
      const existingPosts = await db.encounter_posts.toArray();
      if (existingPosts.length === 0) {
        const all = await db.encounter_strangers.toArray();
        const nameToId = {};
        all.forEach(s => { nameToId[s.name] = s.id; });
        for (let i = 0; i < BUILTIN_POSTS.length; i++) {
          const p = BUILTIN_POSTS[i];
          const authorDef = BUILTIN_STRANGERS[p.authorIdx];
          const authorId = (authorDef && nameToId[authorDef.name]) || 0;
          await db.encounter_posts.add({
            authorId,
            title: p.title,
            content: p.content,
            media: null,
            category: p.category,
            likes: Math.floor(Math.random() * 30),
            commentsCount: 0,
            likedByUser: false,
            isUserPost: 0,
            // 内置帖子按顺序分散在过去 48 小时内
            createdAt: Date.now() - i * 120000 - Math.floor(Math.random() * 60000)
          });
        }
      }
    } catch (e) {
      console.warn('[Encounter] 内置数据初始化失败:', e);
    }
  }

  // ============================================================
  // 4. 入口函数
  // ============================================================
  window.initEncounterApp = async function () {
    injectEncounterStyles();
    await ensureBuiltinData();
    await refreshCaches();
    renderHome();
    renderSquare();
    renderPublishForm();
    bindDockEvents();
    bindHeaderEvents();
    // 默认进入首页
    switchTab('home');
    // 首次进入时若行星系为空，自动生成一批陌生 char（5-8位）
    if (encounterStrangersCache.length === 0) {
      encShowToast('正在召唤星河中的旅人…');
      try {
        await generateStrangers(null);
        renderHome();
      } catch (e) {
        console.warn('[Encounter] 自动生成陌生 char 失败:', e);
      }
    }
  };

  async function refreshCaches() {
    encounterStrangersCache = await db.encounter_strangers.where('status').equals('available').toArray();
    encounterTagsCache = await db.encounter_tags.orderBy('createdAt').toArray();
    encounterCategoriesCache = await db.encounter_categories.orderBy('sortOrder').toArray();
  }

  // ============================================================
  // 5. Dock 与头部事件绑定
  // ============================================================
  function bindDockEvents() {
    const dockBtns = document.querySelectorAll('#win-encounter .encounter-dock-btn');
    dockBtns.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      };
    });
  }

  function bindHeaderEvents() {
    const refreshBtn = document.getElementById('btn-encounter-refresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        // 改造：点击"召唤/刷新"先弹标签选择面板，由面板内"召唤"按钮触发实际生成
        openStrangerSummonPanel();
      };
    }
    const closeBtn = document.querySelector('#win-encounter .encounter-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        if (typeof closeApp === 'function') closeApp('encounter');
      };
    }
    // 关闭人设卡片层
    const cardOverlay = document.getElementById('encounter-card-overlay');
    if (cardOverlay) {
      cardOverlay.addEventListener('click', (e) => {
        if (e.target === cardOverlay) cardOverlay.classList.remove('active');
      });
    }
    const postOverlay = document.getElementById('encounter-post-overlay');
    if (postOverlay) {
      postOverlay.addEventListener('click', (e) => {
        if (e.target === postOverlay) postOverlay.classList.remove('active');
      });
    }
  }

  // 召唤面板：先选标签（多选，可不选），再点"召唤"触发 API 生成 char
  function openStrangerSummonPanel() {
    const overlay = document.getElementById('encounter-post-overlay');
    if (!overlay) return;
    const tags = encounterTagsCache || [];
    const selected = new Set(); // 存选中的 tag.id

    let html = '<div class="enc-card-wrap" style="max-width:360px;">';
    html += `<button class="enc-card-close" id="enc-summon-close">${ENC_ICONS.close}</button>`;
    html += `<div style="font-size:16px; font-weight:700; text-align:center; margin-bottom:4px;">召唤星河旅人</div>`;
    html += `<div class="enc-summon-hint">先选择希望旅人具备的标签（可多选，不选则随机），再点击"召唤"</div>`;

    if (tags.length === 0) {
      html += `<div class="enc-summon-hint" style="margin:14px 0;">标签仓库为空，将完全随机召唤</div>`;
    } else {
      html += '<div class="enc-summon-tag-grid" id="enc-summon-tags">';
      tags.forEach(t => {
        // 标签显示只显示短语；附加说明不显示在 UI 上，仅在召唤时注入 prompt
        html += `<span class="enc-summon-tag" data-tag-id="${t.id}">${encEscapeHtml(t.name)}</span>`;
      });
      html += '</div>';
    }

    // 召唤数量选择
    html += `
      <div style="margin:14px 0 6px; text-align:center;">
        <span class="enc-summon-hint" style="display:inline-block; margin:0 8px 0 0;">数量</span>
        <select id="enc-summon-count" class="enc-form-input" style="width:auto; display:inline-block; padding:6px 10px;">
          <option value="5">5 位</option>
          <option value="6" selected>6 位</option>
          <option value="7">7 位</option>
          <option value="8">8 位</option>
        </select>
        <span class="enc-summon-hint" style="display:inline-block; margin:0 8px;">已选 <span class="enc-summon-count" id="enc-summon-selected-count">0</span> 个标签</span>
      </div>
    `;

    html += `
      <div class="enc-form-actions">
        <button class="enc-form-btn enc-form-btn-secondary" id="enc-summon-cancel">取消</button>
        <button class="enc-form-btn enc-form-btn-primary" id="enc-summon-go">${ENC_ICONS.refresh}召唤</button>
      </div>
    `;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    // 已选数量显示更新
    const selCountEl = () => document.getElementById('enc-summon-selected-count');
    function updateSelCount() {
      const el = selCountEl();
      if (el) el.innerText = String(selected.size);
    }

    // 标签多选切换
    overlay.querySelectorAll('.enc-summon-tag').forEach(chip => {
      chip.onclick = () => {
        const id = parseInt(chip.getAttribute('data-tag-id'));
        if (selected.has(id)) {
          selected.delete(id);
          chip.classList.remove('selected');
        } else {
          selected.add(id);
          chip.classList.add('selected');
        }
        updateSelCount();
      };
    });

    document.getElementById('enc-summon-close').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-summon-cancel').onclick = () => overlay.classList.remove('active');

    // 召唤按钮：取选中标签对象数组，调用 generateStrangers
    document.getElementById('enc-summon-go').onclick = async () => {
      const goBtn = document.getElementById('enc-summon-go');
      const cancelBtn = document.getElementById('enc-summon-cancel');
      const countSel = document.getElementById('enc-summon-count');
      const count = countSel ? parseInt(countSel.value) : 6;
      // 取选中的标签对象（含 description）
      const selectedTagObjs = tags.filter(t => selected.has(t.id));
      // 禁用按钮，显示进度
      if (goBtn) { goBtn.disabled = true; goBtn.innerText = '正在召唤…'; }
      if (cancelBtn) cancelBtn.disabled = true;
      encShowToast(selectedTagObjs.length > 0
        ? `正在按 ${selectedTagObjs.map(t => t.name).join('、')} 召唤旅人…`
        : '正在随机召唤旅人…');
      try {
        await generateStrangers(count, selectedTagObjs);
        renderHome();
        overlay.classList.remove('active');
        encShowToast(selectedTagObjs.length > 0
          ? `${selectedTagObjs.map(t => t.name).join('、')} 旅人已抵达星河`
          : '新的旅人已抵达星河');
      } catch (e) {
        encShowToast('召唤失败：' + (e.message || '未知错误'));
        if (goBtn) { goBtn.disabled = false; goBtn.innerText = ENC_ICONS.refresh + '召唤'; }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    };
  }

  function switchTab(tab) {
    encounterCurrentTab = tab;
    document.querySelectorAll('#win-encounter .encounter-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#win-encounter .encounter-dock-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('encounter-tab-' + tab);
    if (panel) panel.classList.add('active');
    const btn = document.querySelector('#win-encounter .encounter-dock-btn[data-tab="' + tab + '"]');
    if (btn) btn.classList.add('active');
    const title = document.getElementById('encounter-title');
    if (title) {
      title.innerText = tab === 'home' ? '邂逅' : (tab === 'square' ? '广场' : '发布瞬间');
    }
    // 切到广场时刷新帖子流
    if (tab === 'square') {
      renderSquare();
    } else if (tab === 'publish') {
      renderPublishForm();
    } else if (tab === 'home') {
      renderHome();
    }
    // 滚动到顶
    const body = document.getElementById('encounter-body');
    if (body) body.scrollTop = 0;
  }

  // ============================================================
  // 6. 首页：行星系 + 标签仓库
  // ============================================================
  function renderHome() {
    renderGalaxy();
    renderTagsRepo();
  }

  // 获取当前聊天应用面具（user 类型 archive）头像，作为星系中心星球
  async function getActiveUserAvatar() {
    try {
      const uid = localStorage.getItem('active_me_id');
      if (!uid || uid === 'null' || uid === 'undefined') return null;
      const u = await db.archives.get(Number(uid));
      return (u && u.avatar) ? u.avatar : null;
    } catch (e) { return null; }
  }

  // 立体星系渲染：行星由 JS requestAnimationFrame 驱动公转，
  // 始终保持正面朝向（仅 translate，无 rotate），头像清晰、不会像纸片翻转。
  // 星球增多时动态扩展多条不同平面的轨道，并减慢公转速度。
  async function renderGalaxy() {
    const container = document.getElementById('encounter-galaxy');
    if (!container) return;
    // 取消上一帧动画，避免重复叠加
    if (galaxyRafId) { cancelAnimationFrame(galaxyRafId); galaxyRafId = null; }

    // 中心星球：优先用当前聊天面具头像，无则用默认渐变
    const userAvatar = await getActiveUserAvatar();
    const coreBg = userAvatar
      ? `background-image:url('${userAvatar}');`
      : `background: radial-gradient(circle at 35% 30%, #fff7e6 0%, ${SOUL_COLORS.gold} 22%, ${SOUL_COLORS.pink} 58%, ${SOUL_COLORS.purple} 100%);`;

    const strangers = encounterStrangersCache;

    // 视窗切换按钮（始终渲染，控制星系/列表层显隐）
    let html = `
      <div class="galaxy-view-toggle">
        <button id="enc-view-galaxy" class="${encounterHomeView === 'galaxy' ? 'active' : ''}">${ENC_ICONS.grid}星系</button>
        <button id="enc-view-list" class="${encounterHomeView === 'list' ? 'active' : ''}">${ENC_ICONS.list}列表</button>
      </div>
    `;

    // 列表层（char 列表，避免眼晕，点击查看卡片）
    html += '<div id="encounter-galaxy-list" class="' + (encounterHomeView === 'list' ? 'active' : '') + '"></div>';

    // 星系层容器
    html += '<div class="galaxy-stage-wrap" id="encounter-galaxy-stage-wrap" style="' + (encounterHomeView === 'list' ? 'display:none;' : '') + '">';

    if (strangers.length === 0) {
      html += `
        <div class="galaxy-stage">
          <div class="galaxy-core" style="${coreBg}"></div>
          <div class="galaxy-empty-hint">星河寂寥，点击右上角刷新召唤旅人</div>
        </div>
      `;
      html += '</div>';
      container.innerHTML = html;
      bindViewToggle(container);
      return;
    }

    // 动态轨道数：尽量每条轨道只放1-2颗行星，避免聚堆
    // 轨道数 = max(3, ceil(n / 1.5))，上限 8
    const n = strangers.length;
    const orbitCount = Math.min(8, Math.max(3, Math.ceil(n / 1.5)));

    // 多平面：每条轨道用不同 scaleY（倾角）+ 不同半轴 + 不同速度因子
    const tiltPlan = [0.30, 0.46, 0.38, 0.52, 0.34, 0.44, 0.28, 0.50]; // 不同平面倾角
    const baseRx =    [52, 74, 96, 118, 140, 162, 184, 206];             // 基础半轴
    const orbits = [];
    for (let i = 0; i < orbitCount; i++) {
      const rx = baseRx[i] || (100 + i * 28);
      const tilt = tiltPlan[i] || 0.4;
      orbits.push({ rx, ry: rx * tilt, tilt });
    }
    const STAGE = 420, CX = STAGE / 2, CY = STAGE / 2;

    html += `<div class="galaxy-stage" style="width:${STAGE}px; height:${STAGE}px;">`;
    html += `<div class="galaxy-core" style="${coreBg}"></div>`;
    // 轨道环（每条自带 --orbit-tilt 实现不同平面）
    orbits.forEach(o => {
      const w = o.rx * 2;
      html += `<div class="galaxy-orbit" style="width:${w}px; height:${w}px; --orbit-tilt:${o.tilt};"></div>`;
    });
    // 行星：用黄金角分布初始角度，每颗速度大差异，避免聚堆
    const GOLDEN_ANGLE = 137.508;
    const planets = [];
    strangers.forEach((s, idx) => {
      const orbit = orbits[idx % orbits.length];
      // 黄金角分布：保证行星在轨道上均匀散开，不会三两聚堆
      const startAngle = idx * GOLDEN_ANGLE + (idx % 3) * 23;
      // 公转角速度：大幅拉开差异（0.4x~1.8x 随机），内圈快外圈慢，随机正反向
      const baseSpeed = 0.22 - orbit.rx * 0.0006;
      const speedFactor = 0.4 + Math.random() * 1.4; // 0.4~1.8 倍速差异
      const direction = Math.random() > 0.5 ? 1 : -1;
      const speed = baseSpeed * speedFactor * direction;
      // 随机偏移：让行星不必精准落在轨道线上，更自然
      const ox = (Math.random() - 0.5) * 20;
      const oy = (Math.random() - 0.5) * 14;
      const color = planetColor(s.id || s.name);
      const avatar = s.avatarSeed || generateAvatarDataUrl(s.id || s.name, s.name);
      const name = encEscapeHtml(s.name || '旅人');
      html += `
        <div class="galaxy-planet" style="
          background-image:url('${avatar}');
          background-color:${color.bg};
          --planet-glow:${color.glow};
        " data-stranger-id="${s.id}" title="${name}"></div>
      `;
      planets.push({ el: null, angle: startAngle * Math.PI / 180, speed, rx: orbit.rx, ry: orbit.ry, ox, oy });
    });
    html += '</div>'; // galaxy-stage
    html += '</div>'; // galaxy-stage-wrap
    container.innerHTML = html;

    // 渲染列表层内容
    renderGalaxyList();

    // 绑定视窗切换
    bindViewToggle(container);

    // 绑定行星点击 + 收集 planet 元素引用
    const planetEls = container.querySelectorAll('.galaxy-planet');
    planetEls.forEach((el, i) => {
      if (planets[i]) planets[i].el = el;
      el.addEventListener('click', () => {
        const id = parseInt(el.getAttribute('data-stranger-id'));
        const stranger = encounterStrangersCache.find(s => s.id === id);
        if (stranger) openStrangerCard(stranger);
      });
    });

    // JS 公转循环：仅更新 left/top（translate(-50%,-50%) 由 CSS 提供），不旋转 → 不自转
    let lastTs = performance.now();
    function tick(ts) {
      const dt = Math.min(0.05, (ts - lastTs) / 1000); // 限制最大步长，防卡顿后跳跃
      lastTs = ts;
      let allGone = true;
      for (const p of planets) {
        if (!p.el || !p.el.isConnected) continue;
        allGone = false;
        p.angle += p.speed * dt;
        const x = CX + p.rx * Math.cos(p.angle) + p.ox;
        const y = CY + p.ry * Math.sin(p.angle) + p.oy;
        p.el.style.left = x + 'px';
        p.el.style.top = y + 'px';
      }
      if (!allGone) {
        galaxyRafId = requestAnimationFrame(tick);
      }
    }
    // 仅在星系视图下启动动画，节省性能
    if (encounterHomeView === 'galaxy') {
      galaxyRafId = requestAnimationFrame(tick);
    }
  }

  // 视窗切换：星系 ↔ 列表
  function bindViewToggle(container) {
    const galaxyBtn = document.getElementById('enc-view-galaxy');
    const listBtn = document.getElementById('enc-view-list');
    const stageWrap = document.getElementById('encounter-galaxy-stage-wrap');
    const listEl = document.getElementById('encounter-galaxy-list');
    if (galaxyBtn) galaxyBtn.onclick = () => {
      encounterHomeView = 'galaxy';
      if (galaxyBtn) galaxyBtn.classList.add('active');
      if (listBtn) listBtn.classList.remove('active');
      if (stageWrap) stageWrap.style.display = '';
      if (listEl) listEl.classList.remove('active');
      // 重启公转动画
      renderGalaxy();
    };
    if (listBtn) listBtn.onclick = () => {
      encounterHomeView = 'list';
      if (listBtn) listBtn.classList.add('active');
      if (galaxyBtn) galaxyBtn.classList.remove('active');
      if (stageWrap) stageWrap.style.display = 'none';
      if (listEl) listEl.classList.add('active');
      // 停止公转动画，节省性能
      if (galaxyRafId) { cancelAnimationFrame(galaxyRafId); galaxyRafId = null; }
      renderGalaxyList();
    };
  }

  // 渲染 char 列表层
  function renderGalaxyList() {
    const container = document.getElementById('encounter-galaxy-list');
    if (!container) return;
    const strangers = encounterStrangersCache;
    if (strangers.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:${SOUL_COLORS.textSub}; font-size:12px; padding:40px 14px;">星河寂寥，点击右上角刷新召唤旅人</div>`;
      return;
    }
    let html = '';
    strangers.forEach(s => {
      const avatar = s.avatarSeed || generateAvatarDataUrl(s.id || s.name, s.name);
      const name = encEscapeHtml(s.name || '旅人');
      const sub = encEscapeHtml(((s.era || '') + ' · ' + (s.location || '') + ' · ' + (s.identity || '')).replace(/^ · | · $/g, ''));
      const tags = (Array.isArray(s.tags) ? s.tags : []).slice(0, 3);
      let tagsHtml = '';
      tags.forEach(t => { tagsHtml += `<span class="mini-tag">${encEscapeHtml(t)}</span>`; });
      html += `
        <div class="galaxy-list-card" data-stranger-id="${s.id}">
          <img src="${avatar}" alt="">
          <div class="galaxy-list-card-body">
            <div class="galaxy-list-card-name">${name}</div>
            <div class="galaxy-list-card-sub">${sub}</div>
          </div>
          <div class="galaxy-list-card-tags">${tagsHtml}</div>
        </div>
      `;
    });
    container.innerHTML = html;
    container.querySelectorAll('.galaxy-list-card').forEach(card => {
      card.onclick = () => {
        const id = parseInt(card.getAttribute('data-stranger-id'));
        const stranger = encounterStrangersCache.find(s => s.id === id);
        if (stranger) openStrangerCard(stranger);
      };
    });
  }

  function renderTagsRepo() {
    const container = document.getElementById('encounter-tags-repo');
    if (!container) return;
    const tags = encounterTagsCache;
    let html = `
      <div class="tags-repo-header">
        <div class="tags-repo-title">${ENC_ICONS.tag}标签仓库</div>
        <button class="tag-add-btn" id="enc-tag-add">${ENC_ICONS.plus}新增标签</button>
      </div>
      <div class="tags-repo-list">
    `;
    if (tags.length === 0) {
      html += '<span style="font-size:11px; color:' + SOUL_COLORS.textSub + ';">暂无标签，点击右上角添加</span>';
    } else {
      tags.forEach(t => {
        const c = TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.purple;
        html += `
          <span class="tag-chip" style="--tag-bg:${c.bg}; --tag-fg:${c.fg}; --tag-border:${c.border};">
            ${encEscapeHtml(t.name)}
            <span class="tag-del" data-tag-id="${t.id}" title="删除">${ENC_ICONS.close}</span>
          </span>
        `;
      });
    }
    html += '</div>';
    container.innerHTML = html;
    // 绑定事件
    const addBtn = document.getElementById('enc-tag-add');
    if (addBtn) {
      addBtn.onclick = () => openTagForm(); // 弹卡片表单（短语 + 附加说明）
    }
    container.querySelectorAll('.tag-del').forEach(el => {
      el.onclick = async () => {
        const id = parseInt(el.getAttribute('data-tag-id'));
        if (!confirm('确定要删除此标签吗？')) return;
        await db.encounter_tags.delete(id);
        await refreshCaches();
        renderTagsRepo();
        encShowToast('标签已删除');
      };
    });
  }

  // 标签卡片表单：短语（显示）+ 附加说明（不显示，仅注入 prompt）
  // editTag 为可选：传入则编辑现有标签，否则新增
  function openTagForm(editTag) {
    const overlay = document.getElementById('encounter-post-overlay');
    if (!overlay) return;
    const isEdit = !!editTag;
    const tagName = (editTag && editTag.name) || '';
    const tagDesc = (editTag && editTag.description) || '';
    let html = '<div class="enc-card-wrap" style="max-width:340px;">';
    html += `<button class="enc-card-close" id="enc-tag-form-close">${ENC_ICONS.close}</button>`;
    html += `<div style="font-size:15px; font-weight:700; margin-bottom:14px; text-align:center;">${isEdit ? '编辑标签' : '新增标签'}</div>`;
    html += `
      <div class="enc-form-card">
        <div class="enc-form-row">
          <label class="enc-form-label">标签短语（显示用，2-8字）</label>
          <input type="text" class="enc-form-input" id="enc-tag-form-name" placeholder="如：温柔 / 古风 / 学者" maxlength="12" value="${encEscapeHtml(tagName)}">
        </div>
        <div class="enc-form-row">
          <label class="enc-form-label">附加说明（不显示，仅传给 AI 强化语义）</label>
          <textarea class="enc-form-input" id="enc-tag-form-desc" placeholder="如：说话语气柔和细腻，富有共情力，能感知他人情绪" maxlength="200">${encEscapeHtml(tagDesc)}</textarea>
        </div>
        <div class="enc-form-actions">
          <button class="enc-form-btn enc-form-btn-secondary" id="enc-tag-form-cancel">取消</button>
          <button class="enc-form-btn enc-form-btn-primary" id="enc-tag-form-save">${isEdit ? '保存' : '添加'}</button>
        </div>
      </div>
    `;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    document.getElementById('enc-tag-form-close').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-tag-form-cancel').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-tag-form-save').onclick = async () => {
      const saveBtn = document.getElementById('enc-tag-form-save');
      const nameEl = document.getElementById('enc-tag-form-name');
      const descEl = document.getElementById('enc-tag-form-desc');
      const name = (nameEl.value || '').trim();
      const desc = (descEl.value || '').trim();
      if (!name) { encShowToast('请输入标签短语'); return; }
      if (name.length > 12) { encShowToast('标签短语请控制在 12 字以内'); return; }
      if (saveBtn) saveBtn.disabled = true;
      try {
        if (isEdit && editTag) {
          await db.encounter_tags.update(editTag.id, { name, description: desc });
          encShowToast('标签已更新');
        } else {
          // 重复校验
          const dup = encounterTagsCache.find(t => t.name === name);
          if (dup) { encShowToast('标签已存在'); if (saveBtn) saveBtn.disabled = false; return; }
          const color = colorForTag(name);
          await db.encounter_tags.add({ name, color, description: desc, createdAt: Date.now() });
          encShowToast('标签已添加');
        }
        await refreshCaches();
        renderTagsRepo();
        overlay.classList.remove('active');
      } catch (e) {
        encShowToast('保存失败：' + (e.message || '未知错误'));
        if (saveBtn) saveBtn.disabled = false;
      }
    };
  }

  async function addTag(name) {
    // 兼容老调用：直接以名字新增（无附加说明）
    const color = colorForTag(name);
    await db.encounter_tags.add({ name, color, description: '', createdAt: Date.now() });
    await refreshCaches();
    renderTagsRepo();
    encShowToast('标签已添加');
  }

  // ============================================================
  // 7. 广场：分类 + 帖子流
  // ============================================================
  function renderSquare() {
    renderCategories();
    renderPostsStream();
  }

  function renderCategories() {
    const container = document.getElementById('encounter-categories');
    if (!container) return;
    const cats = encounterCategoriesCache;
    let html = '';
    cats.forEach(c => {
      const active = (encounterActiveCategory === null && c.name === '推荐') || encounterActiveCategory === c.name ? 'active' : '';
      html += `<button class="enc-category-chip ${active}" data-cat="${encEscapeHtml(c.name)}">${encEscapeHtml(c.name)}</button>`;
    });
    html += `<button class="enc-category-manage" id="enc-cat-manage">${ENC_ICONS.settings}管理</button>`;
    // 换一批按钮：上下文感知——选中某分类时仅刷新该分类，未选（推荐）时刷新全部
    const refreshLabel = encounterActiveCategory === null ? '换一批' : `换一批·${encEscapeHtml(encounterActiveCategory)}`;
    html += `<button class="enc-category-refresh" id="enc-cat-refresh" title="换一批">${ENC_ICONS.refresh}${refreshLabel}</button>`;
    container.innerHTML = html;
    container.querySelectorAll('.enc-category-chip').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.getAttribute('data-cat');
        encounterActiveCategory = cat === '推荐' ? null : cat;
        renderCategories();
        renderPostsStream();
      };
    });
    const manageBtn = document.getElementById('enc-cat-manage');
    if (manageBtn) manageBtn.onclick = openCategoryManager;
    const refreshBtn = document.getElementById('enc-cat-refresh');
    if (refreshBtn) refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      const targetCat = encounterActiveCategory; // null = 推荐/全部
      encShowToast(targetCat === null ? '正在换一批·全部…' : `正在换一批·${targetCat}…`);
      try {
        // 指定分类时少生成几条（5-7），推荐全部时维持 7-10 条
        const count = targetCat === null ? null : (5 + Math.floor(Math.random() * 3));
        await generatePosts(count, targetCat);
        await renderPostsStream();
        encShowToast(targetCat === null ? '广场已更新' : `${targetCat} 已换一批`);
      } catch (e) {
        encShowToast('换一批失败：' + (e.message || '未知错误'));
      } finally {
        refreshBtn.disabled = false;
      }
    };
  }

  async function openCategoryManager() {
    const overlay = document.getElementById('encounter-post-overlay');
    if (!overlay) return;
    const cats = await db.encounter_categories.orderBy('sortOrder').toArray();
    let html = '<div class="enc-card-wrap" style="max-width:360px;">';
    html += `<button class="enc-card-close" id="enc-cat-close">${ENC_ICONS.close}</button>`;
    html += `<div style="font-size:15px; font-weight:700; margin-bottom:14px; text-align:center;">管理广场分类</div>`;
    html += `<div class="enc-summon-hint" style="margin-bottom:10px;">每个分类由"分类名"（显示）+ "附加说明"（不显示，仅传给 AI 强化主题关联）组成，点击分类可编辑</div>`;
    cats.forEach(c => {
      const editBtn = `<button class="enc-post-action" data-edit-cat="${c.id}" title="编辑" style="margin-right:6px;">${ENC_ICONS.settings}</button>`;
      const delBtn = c.isBuiltin ? '<span style="font-size:10px; color:' + SOUL_COLORS.textSub + '; opacity:0.5;">内置</span>'
        : `<button class="enc-post-action" data-del-cat="${c.id}" title="删除">${ENC_ICONS.trash}</button>`;
      const descHint = (c.description && c.description.trim())
        ? `<span style="font-size:10px; color:${SOUL_COLORS.textSub}; margin-left:6px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">（${encEscapeHtml(c.description.trim().slice(0, 18))}${c.description.trim().length > 18 ? '…' : ''}）</span>`
        : '';
      html += `<div class="enc-cat-item"><span style="display:flex; align-items:center; flex:1; min-width:0;">${encEscapeHtml(c.name)}${descHint}</span><span style="display:flex; gap:4px;">${editBtn}${delBtn}</span></div>`;
    });
    html += `
      <div class="enc-form-actions" style="margin-top:14px;">
        <button class="enc-form-btn enc-form-btn-primary" id="enc-cat-add">${ENC_ICONS.plus}新增分类</button>
      </div>
    `;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('enc-cat-close').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-cat-add').onclick = () => openCategoryForm();
    overlay.querySelectorAll('[data-edit-cat]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.getAttribute('data-edit-cat'));
        const cat = cats.find(c => c.id === id);
        if (cat) openCategoryForm(cat);
      };
    });
    overlay.querySelectorAll('[data-del-cat]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.getAttribute('data-del-cat'));
        if (!confirm('确定要删除此分类吗？该分类下的帖子将保留但变为"推荐"。')) return;
        await db.encounter_categories.delete(id);
        await refreshCaches();
        encShowToast('分类已删除');
        openCategoryManager();
        renderCategories();
      };
    });
  }

  // 分类卡片表单：分类名（显示）+ 附加说明（不显示，仅注入帖子生成 prompt）
  // editCat 为可选：传入则编辑现有分类，否则新增
  function openCategoryForm(editCat) {
    const overlay = document.getElementById('encounter-post-overlay');
    if (!overlay) return;
    const isEdit = !!editCat;
    const catName = (editCat && editCat.name) || '';
    const catDesc = (editCat && editCat.description) || '';
    let html = '<div class="enc-card-wrap" style="max-width:340px;">';
    html += `<button class="enc-card-close" id="enc-cat-form-close">${ENC_ICONS.close}</button>`;
    html += `<div style="font-size:15px; font-weight:700; margin-bottom:14px; text-align:center;">${isEdit ? '编辑分类' : '新增分类'}</div>`;
    html += `
      <div class="enc-form-card">
        <div class="enc-form-row">
          <label class="enc-form-label">分类名（显示用，2-10字）</label>
          <input type="text" class="enc-form-input" id="enc-cat-form-name" placeholder="如：失恋树洞 / 异乡人 / 古风集市" maxlength="10" value="${encEscapeHtml(catName)}" ${isEdit && editCat && editCat.isBuiltin ? 'readonly' : ''}>
        </div>
        <div class="enc-form-row">
          <label class="enc-form-label">附加说明（不显示，仅传给 Ai 强化该分类主题关联）</label>
          <textarea class="enc-form-input" id="enc-cat-form-desc" placeholder="如：帖子必须围绕失恋后的情绪倾诉，作者应是刚分手或暗恋未果的人" maxlength="200">${encEscapeHtml(catDesc)}</textarea>
        </div>
        <div class="enc-form-actions">
          <button class="enc-form-btn enc-form-btn-secondary" id="enc-cat-form-cancel">取消</button>
          <button class="enc-form-btn enc-form-btn-primary" id="enc-cat-form-save">${isEdit ? '保存' : '添加'}</button>
        </div>
      </div>
    `;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    document.getElementById('enc-cat-form-close').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-cat-form-cancel').onclick = () => overlay.classList.remove('active');
    document.getElementById('enc-cat-form-save').onclick = async () => {
      const saveBtn = document.getElementById('enc-cat-form-save');
      const nameEl = document.getElementById('enc-cat-form-name');
      const descEl = document.getElementById('enc-cat-form-desc');
      const name = (nameEl.value || '').trim();
      const desc = (descEl.value || '').trim();
      if (!name) { encShowToast('请输入分类名'); return; }
      if (name.length > 10) { encShowToast('分类名请控制在 10 字以内'); return; }
      if (saveBtn) saveBtn.disabled = true;
      try {
        if (isEdit && editCat) {
          // 内置分类不允许改名，但允许改附加说明
          const patch = editCat.isBuiltin ? { description: desc } : { name, description: desc };
          await db.encounter_categories.update(editCat.id, patch);
          encShowToast('分类已更新');
        } else {
          // 重复校验
          const dup = encounterCategoriesCache.find(c => c.name === name);
          if (dup) { encShowToast('分类已存在'); if (saveBtn) saveBtn.disabled = false; return; }
          const maxOrder = encounterCategoriesCache.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
          await db.encounter_categories.add({
            name, description: desc,
            sortOrder: maxOrder + 1, isBuiltin: 0
          });
          encShowToast('分类已添加');
        }
        await refreshCaches();
        openCategoryManager();
        renderCategories();
      } catch (e) {
        encShowToast('保存失败：' + (e.message || '未知错误'));
        if (saveBtn) saveBtn.disabled = false;
      }
    };
  }

  async function renderPostsStream() {
    const container = document.getElementById('encounter-posts-stream');
    if (!container) return;
    container.innerHTML = '<div class="enc-loading"><div class="enc-loading-spinner"></div>正在加载星河广场…</div>';
    let posts;
    if (encounterActiveCategory === null) {
      // 推荐：全部帖子按时间倒序
      posts = await db.encounter_posts.orderBy('createdAt').reverse().toArray();
    } else {
      posts = await db.encounter_posts.where('category').equals(encounterActiveCategory).reverse().toArray();
    }
    if (posts.length === 0) {
      container.innerHTML = `
        <div class="enc-empty-state">
          ${ENC_ICONS.post}
          <div class="enc-empty-state-title">这里还很安静</div>
          <div class="enc-empty-state-desc">召唤旅人们来发帖，或自己去发布一条瞬间</div>
          <button class="enc-empty-state-btn" id="enc-empty-gen-posts">${ENC_ICONS.refresh}召唤帖子</button>
          <button class="enc-empty-state-btn" id="enc-empty-goto-publish" style="margin-top:10px;">${ENC_ICONS.publish}去发布</button>
        </div>
      `;
      const genBtn = document.getElementById('enc-empty-gen-posts');
      if (genBtn) genBtn.onclick = async () => {
        genBtn.disabled = true;
        genBtn.innerText = '正在召唤…';
        try {
          await generatePosts(null);
          await renderPostsStream();
          encShowToast('广场已热闹起来');
        } catch (e) {
          encShowToast('召唤失败：' + (e.message || '未知错误'));
        } finally {
          genBtn.disabled = false;
        }
      };
      const goBtn = document.getElementById('enc-empty-goto-publish');
      if (goBtn) goBtn.onclick = () => switchTab('publish');
      return;
    }
    // 批量加载作者
    const authorIds = [...new Set(posts.map(p => p.authorId))];
    const authors = await db.encounter_strangers.where('id').anyOf(authorIds).toArray();
    const authorMap = {};
    authors.forEach(a => { authorMap[a.id] = a; });

    let html = '';
    for (let p of posts) {
      const author = authorMap[p.authorId] || { name: '匿名旅人', avatarSeed: generateAvatarDataUrl(p.authorId, '?') };
      const avatar = author.avatarSeed || generateAvatarDataUrl(author.id, author.name);
      const isUserPost = !!p.isUserPost;
      const authorColor = isUserPost ? SOUL_COLORS.gold : SOUL_COLORS.purpleSoft;
      const idline = isUserPost ? '我' : (author.identity || '旅人');
      const mediaHtml = p.media ? `<div class="enc-post-media"><img src="${p.media}" onerror="this.style.display='none'"></div>` : '';
      const likedClass = p.likedByUser ? 'liked' : '';
      html += `
        <div class="enc-post-card" data-post-id="${p.id}">
          <div class="enc-post-header">
            <img class="enc-post-avatar" src="${avatar}" data-stranger-id="${isUserPost ? '' : author.id}">
            <div class="enc-post-meta">
              <div class="enc-post-author" style="color:${authorColor};">${encEscapeHtml(author.name || '匿名旅人')}${isUserPost ? ' (我)' : ''}</div>
              <div class="enc-post-sub">${encEscapeHtml(idline)} · ${encEscapeHtml(p.category || '推荐')} · ${formatTime(p.createdAt)}</div>
            </div>
          </div>
          ${p.title ? `<div class="enc-post-title">${encEscapeHtml(p.title)}</div>` : ''}
          <div class="enc-post-content">${encEscapeHtml(p.content)}</div>
          ${mediaHtml}
          <div class="enc-post-actions">
            <button class="enc-post-action ${likedClass}" data-action="like" data-post-id="${p.id}">${ENC_ICONS.heart}<span>${p.likes || 0}</span></button>
            <button class="enc-post-action" data-action="comment" data-post-id="${p.id}">${ENC_ICONS.comment}<span>${p.commentsCount || 0}</span></button>
            <button class="enc-post-action" data-action="interact" data-post-id="${p.id}" title="生成互动">${ENC_ICONS.interact}<span>互动</span></button>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
    // 绑定事件
    container.querySelectorAll('.enc-post-avatar').forEach(av => {
      av.onclick = () => {
        const sid = av.getAttribute('data-stranger-id');
        if (!sid) return;
        const stranger = encounterStrangersCache.find(s => s.id === parseInt(sid));
        // 如果不在缓存，从db查
        if (!stranger) {
          db.encounter_strangers.get(parseInt(sid)).then(s => { if (s) openStrangerCard(s); });
        } else {
          openStrangerCard(stranger);
        }
      };
    });
    container.querySelectorAll('[data-action="like"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.getAttribute('data-post-id'));
        const post = await db.encounter_posts.get(id);
        if (!post) return;
        const newLiked = !post.likedByUser;
        const newLikes = (post.likes || 0) + (newLiked ? 1 : -1);
        await db.encounter_posts.update(id, { likedByUser: newLiked, likes: Math.max(0, newLikes) });
        renderPostsStream();
      };
    });
    container.querySelectorAll('[data-action="comment"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.getAttribute('data-post-id'));
        openPostDetail(id);
      };
    });
    // 生成互动：调用 AI 生成一条 char 留言
    container.querySelectorAll('[data-action="interact"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.getAttribute('data-post-id'));
        await generateInteractForPost(id);
      };
    });
    // 点击帖子卡片本身也打开详情
    container.querySelectorAll('.enc-post-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('.enc-post-avatar')) return;
        const id = parseInt(card.getAttribute('data-post-id'));
        openPostDetail(id);
      };
    });
  }

  // 生成互动：为帖子生成 5-8 条 char 留言（自动挑选多位陌生 char 回复）
  async function generateInteractForPost(postId) {
    let post;
    try { post = await db.encounter_posts.get(postId); } catch (e) { /* ignore */ }
    if (!post) { encShowToast('帖子不存在'); return; }

    // 挑选多位陌生 char 作为留言者（优先与帖子作者不同，避免自评自赞）
    let candidates = encounterStrangersCache;
    if (candidates.length === 0) {
      try { candidates = await db.encounter_strangers.toArray(); } catch (e) { /* ignore */ }
    }
    if (candidates.length === 0) {
      encShowToast('暂无旅人，先去召唤几位吧');
      return;
    }
    const others = candidates.filter(s => s.id !== post.authorId);
    // 5-8 条回复，但不超过可用旅人数
    const targetCount = Math.min(5 + Math.floor(Math.random() * 4), Math.max(others.length, 1));
    // 轮换挑选留言者，避免重复
    const speakers = [];
    const pool = others.length > 0 ? others.slice() : candidates.slice();
    for (let i = 0; i < targetCount; i++) {
      speakers.push(pool[i % pool.length]);
    }

    encShowToast('正在召唤旅人留言…');
    let successCount = 0;
    for (let i = 0; i < targetCount; i++) {
      const stranger = speakers[i];
      try {
        const comment = await generateSingleComment(post, stranger);
        if (!comment) continue;
        await db.encounter_comments.add({
          postId: post.id,
          authorId: stranger.id,
          content: comment,
          createdAt: Date.now() + i
        });
        successCount++;
      } catch (e) {
        console.warn('[Encounter] 第 ' + (i + 1) + ' 条留言生成失败:', e);
      }
    }
    if (successCount > 0) {
      await db.encounter_posts.update(post.id, { commentsCount: (post.commentsCount || 0) + successCount });
      encShowToast('旅人们留下了 ' + successCount + ' 条回复');
      renderPostsStream();
    } else {
      encShowToast('留言生成失败');
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 2592000000) return Math.floor(diff / 86400000) + '天前';
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // ============================================================
  // 8. 发布瞬间
  // ============================================================
  function renderPublishForm() {
    const container = document.getElementById('encounter-publish-form');
    if (!container) return;
    // 取分类列表
    const cats = encounterCategoriesCache.map(c => c.name);
    const defaultCat = '推荐';
    let catOptions = cats.map(c => `<option value="${encEscapeHtml(c)}" ${c === defaultCat ? 'selected' : ''}>${encEscapeHtml(c)}</option>`).join('');
    container.innerHTML = `
      <div class="enc-publish-card">
        <div class="enc-publish-field">
          <label class="enc-publish-label">标题（可选）</label>
          <input type="text" class="enc-publish-input" id="enc-publish-title" placeholder="给瞬间起个名字…" maxlength="40">
        </div>
        <div class="enc-publish-field">
          <label class="enc-publish-label">分类</label>
          <select class="enc-publish-input" id="enc-publish-cat">${catOptions}</select>
        </div>
        <div class="enc-publish-field">
          <label class="enc-publish-label">正文</label>
          <textarea class="enc-publish-textarea" id="enc-publish-content" placeholder="此刻想说点什么…" maxlength="800"></textarea>
        </div>
        <div class="enc-publish-field">
          <label class="enc-publish-label">配图（可选）</label>
          <button class="enc-publish-img-btn" id="enc-publish-img-btn">${ENC_ICONS.image}选择图片</button>
          <input type="file" id="enc-publish-file" accept="image/*" style="display:none;">
          <div id="enc-publish-img-preview"></div>
        </div>
        <button class="enc-publish-submit" id="enc-publish-submit">发布到广场</button>
      </div>
    `;
    pendingPublishImage = null;
    const fileInput = document.getElementById('enc-publish-file');
    const imgBtn = document.getElementById('enc-publish-img-btn');
    const preview = document.getElementById('enc-publish-img-preview');
    imgBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!f.type.startsWith('image/')) { encShowToast('请选择图片文件'); return; }
      // 压缩到 720px
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const maxSize = 720;
          if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
          else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          pendingPublishImage = canvas.toDataURL('image/jpeg', 0.82);
          preview.innerHTML = `<div class="enc-publish-img-preview"><img src="${pendingPublishImage}"><button class="remove-img" id="enc-publish-remove-img">${ENC_ICONS.close}</button></div>`;
          document.getElementById('enc-publish-remove-img').onclick = () => {
            pendingPublishImage = null;
            preview.innerHTML = '';
            fileInput.value = '';
          };
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(f);
    };
    const submitBtn = document.getElementById('enc-publish-submit');
    submitBtn.onclick = async () => {
      const title = (document.getElementById('enc-publish-title').value || '').trim();
      const content = (document.getElementById('enc-publish-content').value || '').trim();
      const cat = document.getElementById('enc-publish-cat').value || '推荐';
      if (!content) { encShowToast('请输入正文内容'); return; }
      submitBtn.disabled = true;
      submitBtn.innerText = '发布中…';
      try {
        await db.encounter_posts.add({
          authorId: 0, // 0 表示当前用户
          title,
          content,
          media: pendingPublishImage || null,
          category: cat,
          likes: 0,
          commentsCount: 0,
          likedByUser: false,
          isUserPost: 1,
          createdAt: Date.now()
        });
        encShowToast('瞬间已发布，旅人们正在赶来…');
        // 重置表单
        document.getElementById('enc-publish-title').value = '';
        document.getElementById('enc-publish-content').value = '';
        document.getElementById('enc-publish-file').value = '';
        preview.innerHTML = '';
        pendingPublishImage = null;
        // 切换到广场-推荐
        encounterActiveCategory = null;
        switchTab('square');
        // 后台异步触发 char 留言
        generateCommentsForLatestUserPost().catch(e => console.warn('[Encounter] 自动留言生成失败:', e));
      } catch (e) {
        encShowToast('发布失败：' + (e.message || '未知错误'));
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '发布到广场';
      }
    };
  }

  // 为用户最新发布的帖子生成 char 留言
  async function generateCommentsForLatestUserPost() {
    const userPosts = await db.encounter_posts.where('isUserPost').equals(1).reverse().toArray();
    if (userPosts.length === 0) return;
    const post = userPosts[0];
    // 检查是否已有留言
    const existing = await db.encounter_comments.where('postId').equals(post.id).toArray();
    if (existing.length >= 2) return; // 已生成过留言
    // 取 2-3 个陌生 char 来留言
    const strangers = encounterStrangersCache.slice(0, 3);
    if (strangers.length === 0) {
      // 没有可用陌生 char，先生成
      await generateStrangers(null);
    }
    const candidates = encounterStrangersCache.slice(0, 3);
    if (candidates.length === 0) return;
    for (let i = 0; i < Math.min(candidates.length, 2); i++) {
      try {
        const s = candidates[i];
        const comment = await generateSingleComment(post, s);
        await db.encounter_comments.add({
          postId: post.id,
          authorId: s.id,
          content: comment,
          createdAt: Date.now() + i
        });
        await db.encounter_posts.update(post.id, { commentsCount: (post.commentsCount || 0) + i + 1 });
      } catch (e) {
        console.warn('[Encounter] 留言生成失败:', e);
      }
    }
  }

  // ============================================================
  // 9. 陌生 char 人设卡片
  // ============================================================
  function openStrangerCard(stranger) {
    const overlay = document.getElementById('encounter-card-overlay');
    if (!overlay) return;
    const avatar = stranger.avatarSeed || generateAvatarDataUrl(stranger.id, stranger.name);
    const tags = (stranger.tags || []).map(t => {
      const color = colorForTag(t);
      const c = TAG_COLOR_MAP[color];
      return `<span class="tag-chip" style="--tag-bg:${c.bg}; --tag-fg:${c.fg}; --tag-border:${c.border};">${encEscapeHtml(t)}</span>`;
    }).join('');
    const idline = [
      stranger.gender,
      stranger.era,
      stranger.location,
      stranger.identity
    ].filter(Boolean).map(encEscapeHtml).join(' · ');
    overlay.innerHTML = `
      <div class="enc-card-wrap">
        <button class="enc-card-close" id="enc-card-close">${ENC_ICONS.close}</button>
        <img class="enc-card-avatar" src="${avatar}">
        <div class="enc-card-name">${encEscapeHtml(stranger.name || '旅人')}</div>
        <div class="enc-card-idline">${idline || '星河中的旅人'}</div>
        <div class="enc-card-tags">${tags}</div>
        <div class="enc-card-section">
          <div class="enc-card-section-title">${ENC_ICONS.story}背景故事</div>
          <div class="enc-card-section-body">${encEscapeHtml(stranger.background || '暂无背景故事')}</div>
        </div>
        <div class="enc-card-section">
          <div class="enc-card-section-title">${ENC_ICONS.persona}性格特征</div>
          <div class="enc-card-section-body">${encEscapeHtml(stranger.personality || '暂无性格描述')}</div>
        </div>
        <div class="enc-card-actions">
          <button class="enc-card-btn enc-card-btn-secondary" id="enc-card-skip">擦肩而过</button>
          <button class="enc-card-btn enc-card-btn-primary" id="enc-card-promote">${ENC_ICONS.chat}加入档案馆</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    // 右上角叉号：仅收起卡片，不动数据
    document.getElementById('enc-card-close').onclick = () => overlay.classList.remove('active');
    // 擦肩而过：删除此 char（从 db 与缓存中移除），并刷新首页星系
    document.getElementById('enc-card-skip').onclick = () => skipStranger(stranger);
    document.getElementById('enc-card-promote').onclick = () => promoteStranger(stranger);
  }

  // 擦肩而过：彻底删除此陌生 char（db + 缓存 + 星系重渲染）
  async function skipStranger(stranger) {
    if (!stranger || !stranger.id) {
      const overlay = document.getElementById('encounter-card-overlay');
      if (overlay) overlay.classList.remove('active');
      return;
    }
    try {
      await db.encounter_strangers.delete(stranger.id);
      // 同步清理缓存
      encounterStrangersCache = encounterStrangersCache.filter(s => s.id !== stranger.id);
      // 关闭卡片层
      const overlay = document.getElementById('encounter-card-overlay');
      if (overlay) overlay.classList.remove('active');
      encShowToast('已与「' + (stranger.name || '旅人') + '」擦肩而过');
      // 刷新首页星系，让小星球即时消失
      renderHome();
    } catch (e) {
      encShowToast('擦肩而过失败：' + (e.message || '未知错误'));
    }
  }

  // 转正：把陌生 char 作为"角色"加入档案馆的"邂逅"分组
  async function promoteStranger(stranger) {
    try {
      // 检查是否已转正
      const existLog = await db.encounter_promoted_log.where('strangerId').equals(stranger.id).first();
      if (existLog) {
        encShowToast('此旅人已在档案馆中');
        return;
      }
      // 加入档案馆，type=character，group=邂逅（落入角色 tab 的邂逅分组）
      const archiveId = await db.archives.add({
        type: 'character',
        name: stranger.name,
        avatar: stranger.avatarSeed || null,
        remark: '来自邂逅 · ' + (stranger.identity || '旅人'),
        nativeLanguage: '',
        group: '邂逅',
        persona: [
          '【身份】' + (stranger.identity || '未知'),
          '【背景】' + (stranger.background || '未知'),
          '【性格】' + (stranger.personality || '未知'),
          stranger.tags && stranger.tags.length ? '【标签】' + stranger.tags.join('、') : ''
        ].filter(Boolean).join('\n\n'),
        parentId: null,
        appearance: '',
        lockfaceImages: []
      });
      // 写入转正日志
      await db.encounter_promoted_log.add({
        strangerId: stranger.id,
        archiveId,
        promotedAt: Date.now()
      });
      // 标记陌生 char 为已转正
      await db.encounter_strangers.update(stranger.id, { status: 'promoted' });
      // 从缓存移除
      encounterStrangersCache = encounterStrangersCache.filter(s => s.id !== stranger.id);
      // 关闭卡片层
      const overlay = document.getElementById('encounter-card-overlay');
      if (overlay) overlay.classList.remove('active');
      encShowToast('「' + stranger.name + '」已加入档案馆 · 邂逅分组');
      // 刷新首页
      renderHome();
    } catch (e) {
      encShowToast('转正失败：' + (e.message || '未知错误'));
    }
  }

  // ============================================================
  // 10. 帖子详情（含留言）
  // ============================================================
  async function openPostDetail(postId) {
    const overlay = document.getElementById('encounter-post-overlay');
    if (!overlay) return;
    overlay.innerHTML = '<div class="enc-loading"><div class="enc-loading-spinner"></div>加载中…</div>';
    overlay.classList.add('active');
    const post = await db.encounter_posts.get(postId);
    if (!post) { overlay.innerHTML = '<div class="enc-empty-state">帖子不存在</div>'; return; }
    const author = post.authorId ? await db.encounter_strangers.get(post.authorId) : null;
    const comments = await db.encounter_comments.where('postId').equals(postId).toArray();
    const commentAuthorIds = [...new Set(comments.map(c => c.authorId))];
    const commentAuthors = await db.encounter_strangers.where('id').anyOf(commentAuthorIds).toArray();
    const authorMap = {};
    commentAuthors.forEach(a => { authorMap[a.id] = a; });

    const authorName = post.isUserPost ? '我' : (author ? author.name : '匿名旅人');
    const authorAvatar = post.isUserPost
      ? generateAvatarDataUrl('user', '我')
      : (author ? (author.avatarSeed || generateAvatarDataUrl(author.id, author.name)) : generateAvatarDataUrl(postId, '?'));
    const authorColor = post.isUserPost ? SOUL_COLORS.gold : SOUL_COLORS.purpleSoft;
    const idline = post.isUserPost ? '我' : (author ? (author.identity || '旅人') : '匿名旅人');

    let html = '<div class="enc-card-wrap" style="max-width:380px;">';
    html += `<button class="enc-card-close" id="enc-post-close">${ENC_ICONS.close}</button>`;
    html += `
      <div class="enc-post-header">
        <img class="enc-post-avatar" src="${authorAvatar}" data-stranger-id="${post.isUserPost ? '' : (author ? author.id : '')}">
        <div class="enc-post-meta">
          <div class="enc-post-author" style="color:${authorColor};">${encEscapeHtml(authorName)}</div>
          <div class="enc-post-sub">${encEscapeHtml(idline)} · ${encEscapeHtml(post.category || '推荐')} · ${formatTime(post.createdAt)}</div>
        </div>
      </div>
      ${post.title ? `<div class="enc-post-title">${encEscapeHtml(post.title)}</div>` : ''}
      <div class="enc-post-content">${encEscapeHtml(post.content)}</div>
      ${post.media ? `<div class="enc-post-media"><img src="${post.media}" onerror="this.style.display='none'"></div>` : ''}
      <div class="enc-post-actions" style="margin-top:14px;">
        <button class="enc-post-action ${post.likedByUser ? 'liked' : ''}" id="enc-detail-like">${ENC_ICONS.heart}<span>${post.likes || 0}</span></button>
        <button class="enc-post-action">${ENC_ICONS.comment}<span>${comments.length}</span></button>
        <button class="enc-post-action" id="enc-detail-interact" title="生成互动">${ENC_ICONS.interact}<span>互动</span></button>
      </div>
    `;
    // 留言列表
    html += '<div style="margin-top:16px;">';
    html += `<div class="enc-card-section-title" style="margin-bottom:8px;">${ENC_ICONS.comment}留言 (${comments.length})</div>`;
    if (comments.length === 0) {
      html += `<div style="font-size:11px; color:${SOUL_COLORS.textSub}; padding:8px 0;">还没有留言，旅人们正在赶来…</div>`;
    } else {
      comments.forEach(c => {
        const ca = authorMap[c.authorId] || { name: '匿名旅人' };
        const caAvatar = ca.avatarSeed || generateAvatarDataUrl(ca.id, ca.name);
        html += `
          <div class="enc-comment">
            <img class="enc-comment-avatar" src="${caAvatar}" data-stranger-id="${ca.id}">
            <div class="enc-comment-body">
              <div class="enc-comment-author" data-stranger-id="${ca.id}">${encEscapeHtml(ca.name || '匿名旅人')}</div>
              <div class="enc-comment-text">${encEscapeHtml(c.content)}</div>
            </div>
          </div>
        `;
      });
    }
    html += '</div>';
    // 留言输入（仅用户可留言）
    html += `
      <div class="enc-comment-input-row">
        <input type="text" class="enc-comment-input" id="enc-detail-comment-input" placeholder="说点什么…" maxlength="200">
        <button class="enc-comment-send" id="enc-detail-comment-send">${ENC_ICONS.send}</button>
      </div>
    `;
    html += '</div>';
    overlay.innerHTML = html;
    document.getElementById('enc-post-close').onclick = () => overlay.classList.remove('active');
    // 头像点击展开 char 卡片
    overlay.querySelectorAll('.enc-comment-avatar, .enc-post-avatar').forEach(av => {
      av.onclick = () => {
        const sid = av.getAttribute('data-stranger-id');
        if (!sid) return;
        db.encounter_strangers.get(parseInt(sid)).then(s => {
          if (s) {
            // 关闭帖子层，打开 char 卡片
            overlay.classList.remove('active');
            openStrangerCard(s);
          }
        });
      };
    });
    overlay.querySelectorAll('.enc-comment-author[data-stranger-id]').forEach(el => {
      el.onclick = () => {
        const sid = el.getAttribute('data-stranger-id');
        if (!sid) return;
        db.encounter_strangers.get(parseInt(sid)).then(s => {
          if (s) {
            overlay.classList.remove('active');
            openStrangerCard(s);
          }
        });
      };
      el.style.cursor = 'pointer';
    });
    // 点赞
    document.getElementById('enc-detail-like').onclick = async () => {
      const newLiked = !post.likedByUser;
      const newLikes = (post.likes || 0) + (newLiked ? 1 : -1);
      await db.encounter_posts.update(postId, { likedByUser: newLiked, likes: Math.max(0, newLikes) });
      openPostDetail(postId);
      renderPostsStream();
    };
    // 生成互动
    const detailInteractBtn = document.getElementById('enc-detail-interact');
    if (detailInteractBtn) {
      detailInteractBtn.onclick = async () => {
        detailInteractBtn.disabled = true;
        await generateInteractForPost(postId);
        detailInteractBtn.disabled = false;
        openPostDetail(postId);
      };
    }
    // 留言
    document.getElementById('enc-detail-comment-send').onclick = async () => {
      const input = document.getElementById('enc-detail-comment-input');
      const text = (input.value || '').trim();
      if (!text) return;
      await db.encounter_comments.add({
        postId,
        authorId: 0,
        content: text,
        isUserComment: 1,
        createdAt: Date.now()
      });
      await db.encounter_posts.update(postId, { commentsCount: (post.commentsCount || 0) + 1 });
      openPostDetail(postId);
      renderPostsStream();
    };
  }

  // ============================================================
  // 11. AI 生成陌生 char 与广场帖子
  // ============================================================

  // --- 容错解析助手：先用 JSON.parse，失败则用正则按字段抢救 ---
  // 即便 AI 输出多余文字、截断、引号未闭合、字段缺失，也尽量提取可用字段。
  function encLenientParse(content, fields, defaults) {
    let raw = String(content || '');
    // 0. 先剥离 ```json / ``` 代码块包装（很多模型爱套这层壳）
    const fenceM = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceM && fenceM[1]) raw = fenceM[1];
    // 1. 先尝试整体抽取 + 严格解析
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch (_) { /* 落入正则抢救 */ }
    }
    // 2. 正则逐字段抢救
    const out = Object.assign({}, defaults || {});
    fields.forEach(f => {
      if (f.type === 'array') {
        // 抓数组块：尽量抓完整 [...]，否则抓引号项
        const arrRe = new RegExp('"' + f.key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]', 'm');
        const arrM = raw.match(arrRe);
        if (arrM && arrM[1]) {
          const items = arrM[1].match(/"([^"]+)"/g);
          out[f.key] = items ? items.map(s => s.replace(/^"|"$/g, '')).slice(0, (f.max || 5)) : [];
        }
      } else {
        // 字符串字段：匹配 "key":"value"，value 内允许转义引号
        const strRe = new RegExp('"' + f.key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'm');
        const sM = raw.match(strRe);
        if (sM && sM[1] != null) {
          // 反转义常见转义
          out[f.key] = sM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\').trim();
        }
      }
    });
    return out;
  }

  // --- 全局世界书挂载：取"常驻"分组且 isActive 的条目，注入生成 prompt 作为世界观背景 ---
  // 与 app_prompts.js / app_chat.js 的"常驻"分组语义保持一致
  async function getGlobalWorldBookText() {
    try {
      if (!db || !db.world_book_entries) return '';
      const entries = await db.world_book_entries
        .where('group').equals('常驻')
        .and(entry => entry.isActive === true || entry.isActive === 1)
        .toArray();
      if (!entries || entries.length === 0) return '';
      // 按 title 拼装为简洁的世界观说明
      const lines = entries.map(e => {
        const title = (e.title || '').trim();
        const content = (e.content || '').trim();
        if (title && content) return `《${title}》\n${content}`;
        return content || title || '';
      }).filter(Boolean);
      return lines.length ? lines.join('\n\n') : '';
    } catch (e) {
      console.warn('[Encounter] 读取全局世界书失败:', e);
      return '';
    }
  }

  // --- 分类主题筛选助手：让帖子作者与分类强关联 ---
  // 国际→外国 char、古代→古代 char、同城→中国 char、交友→擅长倾听/交友的 char
  function isChineseLocation(loc) {
    if (!loc) return false;
    return /中国|北京|上海|广州|深圳|成都|杭州|南京|苏州|武汉|西安|重庆|天津|长安|临安|洛阳|汴梁|京|沪|粤|蓉|杭|苏|宁|津/.test(String(loc));
  }
  function isForeignLocation(loc) {
    if (!loc) return false;
    return !isChineseLocation(loc);
  }
  function isAncientEra(era) {
    if (!era) return false;
    const s = String(era);
    if (/现代|当代|20|21|2050|1920|未来|近现代/.test(s)) return false;
    return /唐|宋|元|明|清|贞元|开元|永乐|康熙|乾隆|嘉庆|道光|古代|朝|年间|世纪以前/.test(s);
  }
  // 按分类主题挑选最匹配的作者；无匹配则回退到全部
  function pickAuthorForCategory(category, candidates) {
    if (!candidates || candidates.length === 0) return null;
    let filtered = candidates;
    if (category === '国际') {
      filtered = candidates.filter(s => isForeignLocation(s.location));
    } else if (category === '古代') {
      filtered = candidates.filter(s => isAncientEra(s.era));
    } else if (category === '同城') {
      filtered = candidates.filter(s => isChineseLocation(s.location));
    } else if (category === '交友') {
      // 优先选标签含倾听/交友/温柔/浪漫的 char
      filtered = candidates.filter(s => (s.tags || []).some(t => /倾听|交友|温柔|浪漫|倾听者|观察者/.test(t)));
    }
    if (filtered.length === 0) filtered = candidates;
    return filtered[Math.floor(Math.random() * filtered.length)];
  }
  // 分类主题描述：优先取分类的 description（用户/内置的附加说明），否则回退到内置兜底文案
  function categoryThemeHint(category) {
    const cat = encounterCategoriesCache.find(c => c.name === category);
    if (cat && cat.description && cat.description.trim()) {
      return cat.description.trim();
    }
    switch (category) {
      case '国际': return '你必须体现异国生活/异域文化/漂泊海外的见闻与情绪';
      case '古代': return '你必须以古人视角书写，体现古代风物、礼制、身份与时代处境，用半文半白的口吻';
      case '同城': return '你必须围绕本地城市生活、街巷烟火、同城见闻与日常细节展开';
      case '交友': return '你必须带有明确的交友/倾诉/寻伴意图，是在广场上主动寻找同频的人';
      default: return '内容可自由发挥，符合人物处境即可';
    }
  }

  // 广场帖子刷新：一次生成 7-10 条。换一批时先清空目标范围的非 user 帖子（保留用户自发布的）。
  async function generatePosts(count, category) {
    if (count == null) count = 7 + Math.floor(Math.random() * 4); // 7~10
    // 帖子由陌生 char 发布，确保有足够 char
    if (encounterStrangersCache.length < 3) {
      await generateStrangers(null);
    }
    // 换一批：清空目标范围内的非 user 帖子（保留用户自己发的）
    try {
      if (category == null) {
        // 推荐/全部：清空所有非 user 帖子
        const all = await db.encounter_posts.toArray();
        const delIds = all.filter(p => !p.isUserPost).map(p => p.id);
        if (delIds.length) await db.encounter_posts.bulkDelete(delIds);
      } else {
        // 指定分类：仅清空该分类的非 user 帖子
        const catPosts = await db.encounter_posts.where('category').equals(category).toArray();
        const delIds = catPosts.filter(p => !p.isUserPost).map(p => p.id);
        if (delIds.length) await db.encounter_posts.bulkDelete(delIds);
      }
    } catch (e) {
      console.warn('[Encounter] 清空旧帖失败，继续生成:', e);
    }
    const allCats = encounterCategoriesCache.map(c => c.name).filter(n => n !== '推荐');
    // 串行生成，避免并发请求互相干扰
    // 指定 category 时，仅生成该分类的帖子（用于"换一批"独立刷新）
    for (let i = 0; i < count; i++) {
      try {
        await generateSinglePost(allCats, category);
      } catch (e) {
        console.warn('[Encounter] 生成第 ' + (i + 1) + ' 条帖子失败:', e);
      }
    }
  }

  async function generateSinglePost(categories, fixedCategory) {
    const candidates = encounterStrangersCache;
    if (candidates.length === 0) throw new Error('暂无可用旅人');
    // 分类：若指定 fixedCategory 则用之，否则随机（含推荐）
    const allCats = ['推荐'].concat(categories);
    const category = fixedCategory || allCats[Math.floor(Math.random() * allCats.length)];
    // 按分类主题筛选最匹配的作者，让帖子与分类强关联
    const author = pickAuthorForCategory(category, candidates);

    const themeHint = categoryThemeHint(category);
    // 挂载全局世界书：作为客观世界观/物理环境法则设定
    const worldBookText = await getGlobalWorldBookText();
    const worldBookBlock = worldBookText
      ? `\n\n【世界观背景（必须严格遵循）】\n${worldBookText}`
      : '';

    const prompt = `你扮演一位名叫"${author.name}"的虚构人物，身份是${author.identity || '旅人'}，来自${author.era || '未知时代'}的${author.location || '未知地域'}，性格：${author.personality || ''}。背景：${author.background || ''}。${worldBookBlock}

现在你在社交广场的"${category}"分类下发布一条帖子，要求：
1. 内容必须严格符合此人物的身份、时代、性格和处境，不能跳出人物设定
2. 【主题强关联·最高优先级】${themeHint}
3. 标题 8-18 字，正文 60-180 字
4. 可以是生活感悟、求助、分享见闻、交友呼唤等，自然口语化
5. 不要提及自己是虚构角色，不要解释自己在"扮演"
6. 必须严格按以下 JSON 格式输出，禁止输出任何额外文字、解释、Markdown 代码块标记：
{"title":"标题","content":"正文"}`;

    const content = await callAI(
      [{ role: 'user', content: prompt }],
      { temperature: 0.85, max_tokens: 400 }
    );
    // 容错解析：先 JSON.parse，失败则正则逐字段抢救；任一字段缺失则用默认值兜底
    const data = encLenientParse(content, [
      { key: 'title' }, { key: 'content' }
    ], { title: '', content: '' });
    const title = (data.title || '').trim();
    let body = (data.content || '').trim();
    // 若正则抢救后正文仍为空，尝试抓取 JSON 外的纯文本兜底
    if (!body) {
      const stripped = String(content || '').replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/, '').trim();
      body = stripped.slice(0, 200) || '（这是一条来自远方的呢喃）';
    }
    if (!title && !body) {
      // 真的什么都没抢救到才放弃
      console.warn('[Encounter] 帖子 AI 返回完全无法解析:', content);
      throw new Error('AI 返回内容为空');
    }
    const postId = await db.encounter_posts.add({
      authorId: author.id,
      title: title,
      content: body,
      media: null,
      category: category,
      likes: Math.floor(Math.random() * 30),
      commentsCount: 0,
      likedByUser: false,
      isUserPost: 0,
      createdAt: Date.now() - Math.floor(Math.random() * 3600000) // 随机分散在过去 1 小时内
    });
    // 帖子生成后附带 4-6 条评论（一次 API 调用批量生成，减少调用次数）
    try {
      await generateCommentsForPost(postId, title, body, author);
    } catch (e) {
      console.warn('[Encounter] 帖子评论生成失败:', e);
    }
  }

  // 为帖子一次性批量生成 4-6 条评论（单次 API 调用，减少按次收费开销）
  async function generateCommentsForPost(postId, postTitle, postBody, postAuthor) {
    let candidates = encounterStrangersCache;
    if (candidates.length === 0) {
      try { candidates = await db.encounter_strangers.toArray(); } catch (e) { /* ignore */ }
    }
    if (candidates.length === 0) return;
    // 挑选 4-6 位与帖子作者不同的旅人作为评论者
    const others = candidates.filter(s => s.id !== postAuthor.id);
    const pool = others.length > 0 ? others.slice() : candidates.slice();
    const count = Math.min(4 + Math.floor(Math.random() * 3), Math.max(pool.length, 1)); // 4-6 条
    const speakers = [];
    for (let i = 0; i < count; i++) speakers.push(pool[i % pool.length]);

    // 一次 API 调用，让 AI 以多位旅人口吻各写一条评论
    const speakerDesc = speakers.map((s, i) => `${i + 1}. 名叫"${s.name}"，身份：${s.identity || '旅人'}，性格：${s.personality || ''}`).join('\n');
    const prompt = `以下是广场上的一条帖子：
标题：${postTitle || '（无标题）'}
正文：${postBody}

现在有 ${speakers.length} 位旅人看到了这条帖子，请分别以他们的口吻各写一条评论回复。
旅人信息：
${speakerDesc}

要求：
1. 每条评论必须严格符合对应旅人的身份、性格和时代背景
2. 每条 30-80 字，自然口语化，有自己的视角
3. 不要重复帖子内容，不要互相雷同
4. 严格按以下 JSON 数组格式输出，禁止输出任何额外文字或 Markdown 标记：
["评论1","评论2","评论3"]`;

    const content = await callAI([{ role: 'user', content: prompt }], { temperature: 0.9, max_tokens: 800 });
    const data = encLenientParse(content, [], []);
    let comments = Array.isArray(data) ? data : [];
    // 容错：若解析失败尝试正则提取数组元素
    if (comments.length === 0) {
      const matches = String(content || '').match(/"([^"]{5,})"/g);
      if (matches) comments = matches.map(m => m.replace(/^"|"$/g, ''));
    }
    // 逐条保存（评论者按顺序对应 speakers）
    let successCount = 0;
    for (let i = 0; i < Math.min(comments.length, speakers.length); i++) {
      const text = String(comments[i] || '').trim();
      if (!text) continue;
      await db.encounter_comments.add({
        postId: postId,
        authorId: speakers[i].id,
        content: text,
        createdAt: Date.now() - Math.floor(Math.random() * 1800000) // 随机分散在过去 30 分钟内
      });
      successCount++;
    }
    if (successCount > 0) {
      await db.encounter_posts.update(postId, { commentsCount: successCount });
    }
  }

  async function generateStrangers(count, selectedTagObjs) {
    // 随机 5-8 位（用户要求一次返回 5-8 位 char）
    if (count == null) count = 5 + Math.floor(Math.random() * 4); // 5~8
    const tagsPool = encounterTagsCache.map(t => t.name);
    const categories = encounterCategoriesCache.map(c => c.name).filter(n => n !== '推荐');
    // 串行生成，避免并发请求互相干扰
    for (let i = 0; i < count; i++) {
      try {
        await generateSingleStranger(tagsPool, categories, selectedTagObjs);
      } catch (e) {
        console.warn('[Encounter] 生成第 ' + (i + 1) + ' 位旅人失败:', e);
      }
    }
    await refreshCaches();
    // 新旅人入缓存后立即重渲染星系，让小星球即时出现（容器不存在时 renderGalaxy 会安全 return）
    renderGalaxy();
  }

  async function generateSingleStranger(tagsPool, categories, selectedTagObjs) {
    // 优先使用用户在召唤面板选中的标签（含附加说明）；未选则回退到全部标签库
    const useTags = (Array.isArray(selectedTagObjs) && selectedTagObjs.length > 0)
      ? selectedTagObjs
      : encounterTagsCache;

    // 拼装标签提示：name + description（description 不显示在 UI，仅注入 prompt 强化语义）
    const tagLines = useTags.map(t => {
      const name = (t.name || '').trim();
      const desc = (t.description || '').trim();
      if (name && desc) return `- ${name}：${desc}`;
      return name ? `- ${name}` : '';
    }).filter(Boolean);
    const tagHint = tagLines.length > 0
      ? '本次必须从以下标签中挑选 2-4 个作为人物的核心特质，并严格体现这些标签的语义：\n' + tagLines.join('\n')
      : '请从这些方向选 2-4 个标签：温柔/理性/神秘/幽默/独立/浪漫/古风/学者等。';
    const catHint = categories.length > 0 ? '可考虑的时代/地域方向：' + categories.join('、') + '。' : '';

    // 挂载全局世界书：作为客观世界观/物理环境法则设定
    const worldBookText = await getGlobalWorldBookText();
    const worldBookBlock = worldBookText
      ? `\n\n【世界观背景（必须严格遵循）】\n${worldBookText}`
      : '';

    // 收集近期已生成的姓名/姓氏，注入 prompt 避免重复（解决"一抓一大把沈砚舟"问题）
    let avoidNameBlock = '';
    try {
      const recent = await db.encounter_strangers.orderBy('createdAt').reverse().limit(20).toArray();
      const recentNames = recent.map(s => (s.name || '').trim()).filter(Boolean);
      if (recentNames.length > 0) {
        avoidNameBlock = `\n\n【避免重名·最高优先级】以下姓名已存在，绝对不能再次出现，连姓氏也不能重复：\n${recentNames.join('、')}`;
      }
    } catch (e) { /* 忽略，继续 */ }

    const prompt = `你是一个虚构角色生成器。请生成一个有详细背景故事的虚构人物，用于社交邂逅场景。${worldBookBlock}${avoidNameBlock}

要求：
1. 人物可以来自古今中外任何时代和地域（${catHint}），但务必有合理的历史或地域身份。
2. 必须有完整的：姓名、性别、所在时代、所在地域、身份职业。
3. 背景故事要详细（150-250字），交代其成长经历、当前处境、生活状态。背景故事尽量不要有感情线，聚焦于其个人追求、生活困境或事业。
4. 性格特征要鲜明（80-150字），包含外显表现和内在矛盾。
5. 给出 2-4 个性格/身份标签。
   ${tagHint}
6. 姓名要符合其时代和地域特征，姓氏尽量生僻多元，避免常见的"沈/林/苏/顾"等泛滥姓氏，每个姓名都必须独特。

【人设多样性·最高优先级】本次生成的人物必须是【生活百态】中的一员，性格与口吻要鲜明各异，严禁清一色温柔治愈风。请从以下类型中随机选取一种并强烈体现：
- 市井泼辣型：说话直来直去，带方言俚语，烟火气重，可能粗中有细
- 冷峻疏离型：言简意赅，拒人千里，情感内敛，逻辑锋利
- 圆滑世故型：八面玲珑，话里有话，人情练达，擅长周旋
- 憨直莽撞型：心思单纯，容易冲动，说话不过脑子，但真诚
- 阴鸷深沉型：城府极深，话语带刺，记仇，目标感强
- 洒脱不羁型：放浪形骸，玩世不恭，言语轻佻但通透
- 迂腐执拗型：守旧刻板，认死理，引经据典，不通人情
- 精明算计型：锱铢必较，利益至上，话语滴水不漏
不要让所有人物都"温柔细腻有共情力"，世界本就参差多态，请让这个人物带着真实的棱角与瑕疵。

请严格按以下 JSON 格式输出，禁止输出任何额外文字、解释、Markdown 代码块标记：
{
  "name": "姓名",
  "gender": "性别（男/女/其他）",
  "era": "时代，如：唐贞元年间 / 1920年代上海 / 2050年东京 / 当代北京",
  "location": "地域，如：长安 / 上海 / 东京 / 北京",
  "identity": "身份职业，如：太医 / 报馆主笔 / 神经科学家 / 街拍摄影师",
  "background": "详细背景故事（150-250字，无感情线）",
  "personality": "性格特征（80-150字）",
  "tags": ["标签1", "标签2", "标签3"]
}`;

    const content = await callAI(
      [{ role: 'user', content: prompt }],
      { temperature: 0.9, max_tokens: 1000 }
    );
    // 容错解析：先 JSON.parse，失败则正则逐字段抢救；任一字段缺失用默认值兜底
    const data = encLenientParse(content, [
      { key: 'name' },
      { key: 'gender' },
      { key: 'era' },
      { key: 'location' },
      { key: 'identity' },
      { key: 'background' },
      { key: 'personality' },
      { key: 'tags', type: 'array', max: 5 }
    ], {
      name: '无名旅人', gender: '', era: '', location: '',
      identity: '旅人', background: '身世成谜，来历不详。', personality: '性情难辨。', tags: []
    });
    // 至少要有姓名才算抢救成功；否则放弃
    const name = (data.name || '').trim();
    if (!name && !String(content || '').trim()) {
      console.warn('[Encounter] 旅人 AI 返回完全无法解析:', content);
      throw new Error('AI 返回内容为空');
    }
    // 落库
    const stranger = {
      name: name || '无名旅人',
      gender: data.gender || '',
      era: data.era || '',
      location: data.location || '',
      identity: data.identity || '旅人',
      background: data.background || '身世成谜，来历不详。',
      personality: data.personality || '性情难辨。',
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 5) : [],
      status: 'available',
      category: data.location || '',
      avatarSeed: generateAvatarDataUrl(Date.now() + Math.random(), data.name || name),
      createdAt: Date.now()
    };
    const id = await db.encounter_strangers.add(stranger);
    stranger.id = id;
    return stranger;
  }

  // 为帖子生成单条留言
  async function generateSingleComment(post, stranger) {
    const authorName = post.isUserPost ? '我' : '另一位旅人';
    const prompt = `你扮演一位名叫"${stranger.name}"的虚构人物，身份是${stranger.identity || '旅人'}，性格：${stranger.personality || ''}。
现在你看到${authorName}在广场发布了一条帖子：
标题：${post.title || '（无标题）'}
正文：${post.content}

请以"${stranger.name}"的口吻写一条留言回复，要求：
1. 符合此人物的身份、时代和性格特征
2. 50-120字，自然口语化
3. 不要重复帖子内容，要有自己的视角或故事
4. 直接输出留言内容，不要加引号、不要加"留言："等前缀`;

    const content = await callAI([{ role: 'user', content: prompt }], { temperature: 0.9, max_tokens: 300 });
    return content.replace(/^["'"「『]+|["'"」』]+$/g, '').trim();
  }

  // ============================================================
  // 12. 暴露给外部（供 archive 等模块调用）
  // ============================================================
  window.encounterSystem = {
    init: window.initEncounterApp,
    refreshCaches,
    renderHome,
    renderSquare,
    generateStrangers,
    openStrangerCard,
    switchTab,
    SOUL_COLORS
  };

})();
