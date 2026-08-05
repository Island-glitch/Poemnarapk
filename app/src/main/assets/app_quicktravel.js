/**
 * app_quicktravel.js - 快穿局（长文文游应用）
 * ============================================================
 * 设计风格：Skeuomorphism 拟物化，银白色系，性冷淡科技风，禁止 emoji
 * 核心机制：
 *   1. 步进式身份认定（姓名/年龄/外貌/背景，打字动画引导，可从档案库导入）
 *   2. 主页 5 个形状入口（无 dock）：系统空间/领任务/当前任务/美化/进行中剧本
 *   3. 世界观管理（AI 生成/导入导出 JSON/编辑删除/进入游戏）
 *   4. 剧本游玩（~1000 字/轮，3 推荐行动，不抢 user 话）
 *   5. 工具栏：直播系统（弹幕）/ 总结（关键词召回）/ 变量控制 / 剧情引擎
 *   6. 美化系统（主题色/背景/CSS/正则规则，类似酒馆正则，导入导出 JSON）
 * ============================================================
 */
(function () {
  'use strict';

  // ============================================================
  // 0. 拟物化银白色系常量与样式注入
  // ============================================================
  // 浅色银白拟物化调色板：用与背景相似的卡片 + 精致内/外阴影模拟浮雕与嵌入
  const QT_COLORS = {
    bgDeep:    '#e4e9f0', // 主背景：浅银灰
    bgMid:     '#eef1f6', // 中间层
    bgSurface: '#ffffff', // 表面层：纯白
    bgGlass:   'rgba(148,163,184,0.10)', // 玻璃层
    bgInset:   '#dfe4ec', // 嵌入式凹陷底色
    silver:    '#475569', // 主文字
    silverDim: '#64748b', // 次文字
    silverBright: '#1e293b', // 高亮文字（近黑）
    accent:    '#3b82f6', // 强调蓝
    accentDim: 'rgba(59,130,246,0.28)',
    border:    'rgba(148,163,184,0.28)',
    borderBright: 'rgba(100,116,139,0.42)',
    textMain:  '#334155',
    textSub:   '#64748b',
    textDim:   '#94a3b8',
    danger:    '#ef4444',
    success:   '#10b981',
    gold:      '#b45309'
  };

  function injectQuickTravelStyles() {
    if (document.getElementById('qt-style')) return;
    const style = document.createElement('style');
    style.id = 'qt-style';
    style.textContent = `
      /* === 快穿局根容器：浅色银白拟物 === */
      #win-quicktravel {
        background: linear-gradient(160deg, ${QT_COLORS.bgMid} 0%, ${QT_COLORS.bgDeep} 60%, ${QT_COLORS.bgInset} 100%) !important;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif;
      }
      #win-quicktravel .win-header {
        background: linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3)) !important;
        border-bottom: 1px solid ${QT_COLORS.border} !important;
        backdrop-filter: blur(20px);
      }
      #qt-body {
        position: relative;
        flex: 1;
        overflow: hidden;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      #qt-body *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      #qt-body * { scrollbar-width: none !important; }

      /* === 拟物化按钮基底：浮雕白底 + 内高光 + 外柔影 === */
      .qt-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 18px;
        border-radius: 10px;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        color: ${QT_COLORS.silver};
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 1px 3px rgba(100,116,139,0.18), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(148,163,184,0.15);
        letter-spacing: 0.5px;
      }
      .qt-btn:hover {
        border-color: ${QT_COLORS.borderBright};
        color: ${QT_COLORS.silverBright};
        box-shadow: 0 2px 8px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-btn:active {
        transform: scale(0.97);
        box-shadow: inset 0 2px 5px rgba(100,116,139,0.25), 0 1px 2px rgba(100,116,139,0.1);
      }
      .qt-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .qt-btn-primary {
        background: linear-gradient(180deg, rgba(59,130,246,0.18), rgba(59,130,246,0.08));
        border-color: ${QT_COLORS.accentDim};
        color: ${QT_COLORS.silverBright};
        box-shadow: 0 2px 8px rgba(59,130,246,0.2), inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .qt-btn-primary:hover {
        background: linear-gradient(180deg, rgba(59,130,246,0.26), rgba(59,130,246,0.14));
        box-shadow: 0 4px 14px rgba(59,130,246,0.3), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .qt-btn-danger {
        border-color: rgba(239,68,68,0.35);
        color: ${QT_COLORS.danger};
      }
      .qt-btn-icon {
        padding: 8px;
        border-radius: 8px;
      }
      .qt-btn svg { width: 16px; height: 16px; }
      .qt-tool-icon { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0; color: ${QT_COLORS.accent}; }
      .qt-tool-icon svg { width: 18px; height: 18px; }

      /* === 面板/卡片：与背景相似的浅色卡片 + 浮雕阴影 === */
      .qt-panel {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 14px 20px;
      }
      .qt-card {
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.14), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(148,163,184,0.12);
        transition: all 0.2s ease;
      }
      .qt-card-hover:hover {
        border-color: ${QT_COLORS.borderBright};
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(100,116,139,0.2), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-section-title {
        font-size: 11px;
        font-weight: 700;
        color: ${QT_COLORS.textDim};
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .qt-section-title svg { width: 14px; height: 14px; }

      /* === 主页入口形状（无 dock，各种拟物形状入口）=== */
      #qt-home {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        padding: 20px 16px;
        overflow-y: auto;
      }
      .qt-home-header {
        text-align: center;
        margin-bottom: 24px;
      }
      .qt-home-title {
        font-size: 22px;
        font-weight: 200;
        color: ${QT_COLORS.silverBright};
        letter-spacing: 6px;
        margin-bottom: 4px;
      }
      .qt-home-sub {
        font-size: 10px;
        color: ${QT_COLORS.textDim};
        letter-spacing: 3px;
        text-transform: uppercase;
      }
      .qt-entrances {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 20px;
      }
      .qt-entrance {
        position: relative;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px 12px;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        box-shadow: 0 3px 12px rgba(100,116,139,0.16), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(148,163,184,0.14);
      }
      /* 不同形状的入口 */
      .qt-entrance-shape-1 { border-radius: 20px 4px 20px 4px; }
      .qt-entrance-shape-2 { border-radius: 4px 20px 4px 20px; }
      .qt-entrance-shape-3 { border-radius: 50% 20% 50% 20%; }
      .qt-entrance-shape-4 { border-radius: 20% 50% 20% 50%; }
      .qt-entrance:hover {
        border-color: ${QT_COLORS.accentDim};
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-entrance:active {
        transform: scale(0.97);
        box-shadow: inset 0 2px 6px rgba(100,116,139,0.25);
      }
      .qt-entrance svg { width: 36px; height: 36px; color: ${QT_COLORS.silverDim}; transition: color 0.3s; }
      .qt-entrance:hover svg { color: ${QT_COLORS.accent}; }
      .qt-entrance-name {
        font-size: 13px;
        font-weight: 600;
        color: ${QT_COLORS.silver};
        letter-spacing: 2px;
      }
      .qt-entrance-badge {
        position: absolute;
        top: 8px; right: 8px;
        min-width: 18px; height: 18px;
        border-radius: 9px;
        background: ${QT_COLORS.accent};
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
        box-shadow: 0 2px 6px rgba(59,130,246,0.4);
      }

      /* === 进行中剧本块（整宽，非网格）=== */
      .qt-active-block {
        grid-column: 1 / -1;
        flex-direction: row;
        padding: 16px;
        align-items: center;
        justify-content: flex-start;
        gap: 14px;
      }
      .qt-active-block .qt-entrance-name { font-size: 14px; }
      .qt-active-list {
        display: flex;
        gap: 10px;
        flex: 1;
        overflow-x: auto;
        padding: 4px 0;
      }
      .qt-active-chip {
        flex-shrink: 0;
        padding: 8px 14px;
        border-radius: 10px;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        color: ${QT_COLORS.silver};
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .qt-active-chip:hover {
        border-color: ${QT_COLORS.accentDim};
        color: ${QT_COLORS.silverBright};
      }

      /* === 步进式身份设定 === */
      #qt-wizard {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 24px 20px;
      }
      .qt-wizard-step-indicator {
        display: flex;
        justify-content: center;
        gap: 6px;
        margin-bottom: 24px;
      }
      .qt-step-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: ${QT_COLORS.border};
        transition: all 0.3s;
      }
      .qt-step-dot.active {
        background: ${QT_COLORS.accent};
        box-shadow: 0 0 8px ${QT_COLORS.accentDim};
      }
      .qt-step-dot.done { background: ${QT_COLORS.success}; }
      .qt-wizard-title {
        text-align: center;
        font-size: 16px;
        font-weight: 300;
        color: ${QT_COLORS.silverBright};
        letter-spacing: 3px;
        margin-bottom: 8px;
      }
      .qt-typing-text {
        text-align: center;
        font-size: 12px;
        color: ${QT_COLORS.textSub};
        line-height: 1.8;
        min-height: 40px;
        margin-bottom: 20px;
        white-space: pre-wrap;
      }
      .qt-typing-cursor {
        display: inline-block;
        width: 8px;
        height: 14px;
        background: ${QT_COLORS.accent};
        animation: qt-cursor-blink 0.8s steps(2) infinite;
        vertical-align: text-bottom;
        margin-left: 2px;
      }
      @keyframes qt-cursor-blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
      .qt-wizard-input {
        width: 100%;
        box-sizing: border-box;
        background: ${QT_COLORS.bgInset};
        border: 1px solid ${QT_COLORS.border};
        border-radius: 12px;
        padding: 14px 16px;
        box-shadow: inset 0 1px 3px rgba(100,116,139,0.16), inset 0 -1px 0 rgba(255,255,255,0.6);
        color: ${QT_COLORS.textMain};
        font-size: 14px;
        outline: none;
        font-family: inherit;
        transition: border-color 0.2s;
      }
      .qt-wizard-input:focus { border-color: ${QT_COLORS.accentDim}; }
      textarea.qt-wizard-input { resize: vertical; min-height: 80px; line-height: 1.6; }
      .qt-wizard-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      .qt-wizard-actions .qt-btn { flex: 1; }
      .qt-archive-selector {
        max-height: 200px;
        overflow-y: auto;
        margin: 12px 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .qt-archive-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        cursor: pointer;
        transition: all 0.2s;
      }
      .qt-archive-option:hover { border-color: ${QT_COLORS.accentDim}; }
      .qt-archive-option img {
        width: 36px; height: 36px;
        border-radius: 50%;
        border: 1px solid ${QT_COLORS.border};
      }
      .qt-archive-option-info { flex: 1; min-width: 0; }
      .qt-archive-option-name { font-size: 13px; font-weight: 600; color: ${QT_COLORS.silver}; }
      .qt-archive-option-note { font-size: 10px; color: ${QT_COLORS.textSub}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* === 系统空间 === */
      .qt-identity-fold {
        cursor: pointer;
        transition: all 0.2s;
      }
      .qt-identity-fold-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .qt-identity-fold-arrow {
        transition: transform 0.3s;
        color: ${QT_COLORS.textSub};
      }
      .qt-identity-fold.open .qt-identity-fold-arrow { transform: rotate(90deg); }
      .qt-identity-body {
        display: none;
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid ${QT_COLORS.border};
      }
      .qt-identity-fold.open .qt-identity-body { display: block; animation: qt-fade-in 0.3s ease; }
      .qt-identity-row {
        display: flex;
        margin-bottom: 10px;
        font-size: 12px;
        line-height: 1.6;
      }
      .qt-identity-label {
        width: 70px;
        flex-shrink: 0;
        color: ${QT_COLORS.textDim};
        font-weight: 600;
      }
      .qt-identity-value {
        flex: 1;
        color: ${QT_COLORS.textMain};
      }
      .qt-book-shelf {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-top: 14px;
      }
      .qt-book {
        aspect-ratio: 3/4;
        border-radius: 4px 8px 8px 4px;
        background: linear-gradient(135deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-left: 3px solid ${QT_COLORS.accentDim};
        box-shadow: 2px 4px 12px rgba(100,116,139,0.2), inset 0 1px 0 rgba(255,255,255,0.95);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 10px 8px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      .qt-book:hover {
        transform: translateY(-3px) rotate(-1deg);
        box-shadow: 4px 8px 20px rgba(100,116,139,0.28), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-book-title {
        font-size: 10px;
        font-weight: 700;
        color: ${QT_COLORS.silver};
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
      }
      .qt-book-status {
        font-size: 9px;
        color: ${QT_COLORS.success};
        letter-spacing: 1px;
      }

      /* === 世界观列表 === */
      .qt-worldview-card {
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.14), inset 0 1px 0 rgba(255,255,255,0.95);
        cursor: pointer;
        transition: all 0.2s;
      }
      .qt-worldview-card:hover {
        border-color: ${QT_COLORS.borderBright};
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(100,116,139,0.2), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-wv-title {
        font-size: 15px;
        font-weight: 700;
        color: ${QT_COLORS.silverBright};
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .qt-wv-title svg { width: 16px; height: 16px; flex-shrink: 0; }
      .qt-wv-synopsis {
        font-size: 12px;
        color: ${QT_COLORS.textSub};
        line-height: 1.6;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        margin-bottom: 10px;
      }
      .qt-wv-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .qt-wv-tag {
        font-size: 10px;
        padding: 3px 8px;
        border-radius: 6px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        color: ${QT_COLORS.silverDim};
        border: 1px solid ${QT_COLORS.border};
      }
      .qt-wv-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid ${QT_COLORS.border};
      }
      .qt-wv-actions .qt-btn { padding: 6px 12px; font-size: 11px; }

      /* === 表单输入 === */
      .qt-form-group { margin-bottom: 14px; }
      .qt-form-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        color: ${QT_COLORS.textSub};
        margin-bottom: 6px;
        letter-spacing: 1px;
      }
      .qt-form-input {
        width: 100%;
        box-sizing: border-box;
        background: ${QT_COLORS.bgInset};
        border: 1px solid ${QT_COLORS.border};
        border-radius: 10px;
        padding: 10px 14px;
        color: ${QT_COLORS.textMain};
        font-size: 13px;
        outline: none;
        font-family: inherit;
        transition: border-color 0.2s, box-shadow 0.2s;
        box-shadow: inset 0 1px 3px rgba(100,116,139,0.18), inset 0 -1px 0 rgba(255,255,255,0.6);
      }
      .qt-form-input:focus {
        border-color: ${QT_COLORS.accentDim};
        box-shadow: inset 0 1px 3px rgba(100,116,139,0.18), 0 0 0 3px rgba(59,130,246,0.12);
      }
      textarea.qt-form-input { resize: vertical; min-height: 70px; line-height: 1.6; }
      .qt-accordion {
        border: 1px solid ${QT_COLORS.border};
        border-radius: 10px;
        margin-bottom: 8px;
        overflow: hidden;
      }
      .qt-accordion-header {
        padding: 12px 14px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        font-weight: 600;
        color: ${QT_COLORS.silver};
      }
      .qt-accordion-body {
        display: none;
        padding: 12px 14px;
        border-top: 1px solid ${QT_COLORS.border};
      }
      .qt-accordion.open .qt-accordion-body { display: block; }
      .qt-accordion-arrow { transition: transform 0.3s; color: ${QT_COLORS.textSub}; display: inline-flex; }
      .qt-accordion-arrow svg { width: 12px; height: 12px; }
      .qt-accordion.open .qt-accordion-arrow { transform: rotate(90deg); }
      .qt-accordion-header > span:first-child svg { width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; }

      /* === 世界书手风琴式选择框 === */
      .qt-wb-item {
        border: 1px solid ${QT_COLORS.border};
        border-radius: 8px;
        overflow: hidden;
        background: ${QT_COLORS.bgSurface};
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.10), 0 1px 2px rgba(100,116,139,0.06);
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .qt-wb-item.selected {
        border-color: ${QT_COLORS.accentDim};
        box-shadow: inset 0 1px 2px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.18);
      }
      .qt-wb-item-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        cursor: pointer;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
      }
      .qt-wb-item-title {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        color: ${QT_COLORS.silver};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .qt-wb-item-group {
        font-size: 9px;
        color: ${QT_COLORS.textSub};
        background: ${QT_COLORS.bgInset};
        padding: 2px 6px;
        border-radius: 4px;
        box-shadow: inset 0 1px 1px rgba(100,116,139,0.18);
      }
      .qt-wb-item-arrow { transition: transform 0.3s; color: ${QT_COLORS.textSub}; display: inline-flex; }
      .qt-wb-item-arrow svg { width: 12px; height: 12px; }
      .qt-wb-item.open .qt-wb-item-arrow { transform: rotate(90deg); }
      .qt-wb-item-body {
        display: none;
        padding: 10px;
        border-top: 1px solid ${QT_COLORS.border};
        background: ${QT_COLORS.bgInset};
        box-shadow: inset 0 2px 4px rgba(100,116,139,0.12);
      }
      .qt-wb-item.open .qt-wb-item-body { display: block; }
      .qt-wb-item-content {
        font-size: 11px;
        color: ${QT_COLORS.textMain};
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 160px;
        overflow-y: auto;
      }
      /* 拟物化复选框 */
      .qt-wb-check {
        position: relative;
        display: inline-flex;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        cursor: pointer;
      }
      .qt-wb-check input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        cursor: pointer;
        z-index: 2;
      }
      .qt-wb-checkmark {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgInset});
        border: 1px solid ${QT_COLORS.border};
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.25);
        transition: all 0.2s;
      }
      .qt-wb-check input:checked + .qt-wb-checkmark {
        background: linear-gradient(180deg, ${QT_COLORS.accent}, ${QT_COLORS.accentDim});
        border-color: ${QT_COLORS.accentDim};
        box-shadow: inset 0 1px 2px rgba(37,99,235,0.35), 0 0 0 1px rgba(59,130,246,0.25);
      }
      .qt-wb-check input:checked + .qt-wb-checkmark::after {
        content: '';
        position: absolute;
        left: 5px;
        top: 2px;
        width: 4px;
        height: 8px;
        border: solid #fff;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }

      /* === 挂载资源单选卡片 === */
      .qt-mount-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid ${QT_COLORS.border};
        border-radius: 10px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.08), 0 1px 2px rgba(100,116,139,0.06);
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .qt-mount-option.selected {
        border-color: ${QT_COLORS.accentDim};
        box-shadow: inset 0 1px 2px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.18);
      }
      .qt-mount-radio {
        position: relative;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex-shrink: 0;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgInset});
        border: 1px solid ${QT_COLORS.border};
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.25);
        transition: all 0.2s;
      }
      .qt-mount-radio.selected {
        border-color: ${QT_COLORS.accentDim};
        background: linear-gradient(180deg, ${QT_COLORS.accent}, ${QT_COLORS.accentDim});
        box-shadow: inset 0 1px 2px rgba(37,99,235,0.35), 0 0 0 1px rgba(59,130,246,0.25);
      }
      .qt-mount-radio.selected::after {
        content: '';
        position: absolute;
        left: 4px;
        top: 4px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 1px rgba(37,99,235,0.4);
      }

      /* === 剧本游玩页 === */
      #qt-game {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .qt-game-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        border-bottom: 1px solid ${QT_COLORS.border};
        flex-shrink: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3));
      }
      .qt-game-title {
        flex: 1;
        font-size: 13px;
        font-weight: 600;
        color: ${QT_COLORS.silverBright};
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .qt-game-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .qt-msg {
        max-width: 88%;
        padding: 14px 16px;
        border-radius: 16px;
        font-size: 13px;
        line-height: 1.8;
        white-space: pre-wrap;
        word-break: break-word;
        animation: qt-fade-in 0.4s ease;
      }
      .qt-msg-user {
        align-self: flex-end;
        background: linear-gradient(135deg, rgba(59,130,246,0.25), rgba(59,130,246,0.15));
        border: 1px solid ${QT_COLORS.accentDim};
        color: ${QT_COLORS.silverBright};
        border-radius: 16px 16px 4px 16px;
        box-shadow: 0 2px 8px rgba(59,130,246,0.20), inset 0 1px 0 rgba(255,255,255,0.7);
      }
      .qt-msg-ai {
        align-self: flex-start;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        color: ${QT_COLORS.textMain};
        border-radius: 16px 16px 16px 4px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.14), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(148,163,184,0.1);
        position: relative;
      }
      .qt-msg-ai b, .qt-msg-ai strong { color: ${QT_COLORS.gold}; font-weight: 700; }
      .qt-msg-ai i, .qt-msg-ai em { color: ${QT_COLORS.silverDim}; font-style: italic; }
      .qt-msg-actions {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed ${QT_COLORS.border};
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .qt-action-chip {
        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        color: ${QT_COLORS.silver};
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        line-height: 1.5;
        box-shadow: 0 1px 3px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .qt-action-chip:hover {
        border-color: ${QT_COLORS.accentDim};
        color: ${QT_COLORS.silverBright};
        background: rgba(59,130,246,0.08);
        box-shadow: 0 2px 8px rgba(59,130,246,0.16), inset 0 1px 0 rgba(255,255,255,1);
      }
      .qt-game-input-bar {
        flex-shrink: 0;
        padding: 10px 14px;
        border-top: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgMid}, ${QT_COLORS.bgSurface});
        display: flex;
        gap: 8px;
        align-items: flex-end;
        box-shadow: 0 -2px 8px rgba(100,116,139,0.08);
      }
      .qt-game-input {
        flex: 1;
        background: ${QT_COLORS.bgInset};
        border: 1px solid ${QT_COLORS.border};
        border-radius: 12px;
        padding: 10px 14px;
        color: ${QT_COLORS.textMain};
        font-size: 13px;
        outline: none;
        font-family: inherit;
        resize: none;
        max-height: 120px;
        min-height: 40px;
        line-height: 1.5;
        transition: border-color 0.2s, box-shadow 0.2s;
        box-shadow: inset 0 1px 3px rgba(100,116,139,0.16), inset 0 -1px 0 rgba(255,255,255,0.6);
      }
      .qt-game-input:focus {
        border-color: ${QT_COLORS.accentDim};
        box-shadow: inset 0 1px 3px rgba(100,116,139,0.16), 0 0 0 3px rgba(59,130,246,0.12);
      }
      .qt-send-btn {
        width: 40px; height: 40px;
        border-radius: 50%;
        border: 1px solid ${QT_COLORS.accentDim};
        background: linear-gradient(180deg, rgba(59,130,246,0.3), rgba(59,130,246,0.15));
        color: ${QT_COLORS.silverBright};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.5);
      }
      .qt-send-btn:hover { box-shadow: 0 4px 14px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.6); }
      .qt-send-btn:active {
        transform: scale(0.9);
        box-shadow: inset 0 2px 5px rgba(59,130,246,0.3);
      }
      .qt-send-btn:disabled { opacity: 0.4; }
      .qt-send-btn svg { width: 18px; height: 18px; }

      /* === 系统球球 === */
      #qt-sys-ball {
        position: absolute;
        left: 16px; top: 70px;
        width: 64px; height: 64px;
        z-index: 50;
        user-select: none;
        touch-action: none;
      }
      .qt-sys-ball-inner {
        position: relative;
        width: 100%; height: 100%;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #ffffff 0%, #dbeafe 35%, #93c5fd 70%, #3b82f6 100%);
        border: 2px solid #bfdbfe;
        box-shadow:
          0 6px 16px rgba(59,130,246,0.35),
          inset 0 -6px 12px rgba(37,99,235,0.25),
          inset 0 4px 8px rgba(255,255,255,0.7);
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        overflow: hidden;
      }
      .qt-sys-ball-inner:active { cursor: grabbing; transform: scale(0.95); }
      .qt-sys-ball-inner.bounce { animation: qt-sys-bounce 0.5s ease; }
      @keyframes qt-sys-bounce {
        0%, 100% { transform: scale(1); }
        30% { transform: scale(1.15, 0.85); }
        60% { transform: scale(0.92, 1.08); }
      }
      .qt-sys-face {
        font-size: 13px;
        line-height: 1;
        white-space: nowrap;
        font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif;
        text-shadow: 0 1px 2px rgba(0,0,0,0.15);
        pointer-events: none;
      }
      /* 系统冒泡对话气泡 */
      .qt-sys-bubble {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-6px);
        background: linear-gradient(180deg, #ffffff, #eff6ff);
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 11px;
        line-height: 1.5;
        color: #1e3a8a;
        white-space: pre-wrap;
        word-break: break-word;
        max-width: 260px;
        min-width: 80px;
        box-shadow: 0 4px 12px rgba(59,130,246,0.2);
        z-index: 60;
        animation: qt-sys-bubble-in 0.3s ease;
      }
      .qt-sys-bubble::after {
        content: '';
        position: absolute;
        top: 100%; left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #eff6ff;
      }
      @keyframes qt-sys-bubble-in {
        from { opacity: 0; transform: translateX(-50%) translateY(4px); }
        to { opacity: 1; transform: translateX(-50%) translateY(-6px); }
      }
      /* 系统工具栏 */
      .qt-sys-toolbar {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        background: linear-gradient(180deg, #ffffff, #f1f5f9);
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-shadow: 0 6px 20px rgba(100,116,139,0.25);
        z-index: 70;
        min-width: 140px;
        animation: qt-sys-toolbar-in 0.25s ease;
      }
      @keyframes qt-sys-toolbar-in {
        from { opacity: 0; transform: translateX(-50%) translateY(0); }
        to { opacity: 1; transform: translateX(-50%) translateY(-10px); }
      }
      .qt-sys-tool-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        font-size: 12px;
        color: #334155;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(100,116,139,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
        transition: all 0.15s;
      }
      .qt-sys-tool-btn:hover {
        border-color: #93c5fd;
        box-shadow: 0 2px 6px rgba(59,130,246,0.2);
      }
      .qt-sys-tool-btn:active { transform: scale(0.97); box-shadow: inset 0 1px 3px rgba(59,130,246,0.2); }
      .qt-sys-tool-btn svg { width: 16px; height: 16px; color: #3b82f6; }
      /* 求助/道具对话卡 */
      .qt-sys-card {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        width: 260px;
        background: linear-gradient(180deg, #ffffff, #f1f5f9);
        border: 1px solid #bfdbfe;
        border-radius: 14px;
        padding: 12px;
        box-shadow: 0 8px 24px rgba(59,130,246,0.25);
        z-index: 80;
        animation: qt-sys-toolbar-in 0.25s ease;
      }
      .qt-sys-card-title {
        font-size: 12px; font-weight: 700; color: #1e3a8a;
        margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
      }
      .qt-sys-card-title .qt-sys-face { font-size: 16px; }
      .qt-sys-card textarea {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        resize: vertical;
        min-height: 60px;
        background: #fff;
        color: #334155;
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.1);
      }
      .qt-sys-card-reply {
        font-size: 11px;
        color: #475569;
        line-height: 1.6;
        background: #eff6ff;
        border-radius: 8px;
        padding: 8px 10px;
        margin-top: 8px;
        max-height: 120px;
        overflow-y: auto;
        white-space: pre-wrap;
        box-shadow: inset 0 1px 2px rgba(59,130,246,0.1);
      }
      .qt-sys-card-actions { display: flex; gap: 6px; margin-top: 8px; }
      .qt-sys-card-actions button {
        flex: 1;
        padding: 6px;
        border: 1px solid #93c5fd;
        border-radius: 6px;
        background: linear-gradient(180deg, #3b82f6, #2563eb);
        color: #fff;
        font-size: 11px;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(59,130,246,0.3);
      }
      .qt-sys-card-actions .qt-sys-cancel {
        background: linear-gradient(180deg, #f1f5f9, #e2e8f0);
        color: #64748b;
        border-color: #cbd5e1;
      }
      .qt-loading-dots {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .qt-loading-dots span {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: ${QT_COLORS.accent};
        animation: qt-dot-bounce 1.2s ease-in-out infinite;
      }
      .qt-loading-dots span:nth-child(2) { animation-delay: 0.15s; }
      .qt-loading-dots span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes qt-dot-bounce {
        0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      /* === 弹幕系统：覆盖全宽，从最右冒头到最左飘出 === */
      #qt-danmaku-layer {
        position: absolute;
        top: 0; left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 5;
      }
      .qt-danmaku {
        position: absolute;
        left: 100%;
        white-space: nowrap;
        padding: 5px 14px;
        border-radius: 16px;
        background: rgba(255,255,255,0.62);
        backdrop-filter: blur(12px) saturate(140%);
        -webkit-backdrop-filter: blur(12px) saturate(140%);
        border: 1px solid rgba(255,255,255,0.85);
        color: ${QT_COLORS.textMain};
        font-size: 11px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.16), inset 0 1px 0 rgba(255,255,255,0.9);
        will-change: transform;
      }
      .qt-danmaku .qt-dm-name { color: ${QT_COLORS.accent}; font-weight: 700; margin-right: 5px; }

      /* === 覆盖层（通用弹窗）：浅色磨砂 + 浮雕卡片 === */
      #qt-overlay {
        position: absolute;
        inset: 0;
        z-index: 50;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(226,232,240,0.65);
        backdrop-filter: blur(10px);
      }
      #qt-overlay.active { display: flex; }
      .qt-overlay-card {
        width: 92%;
        max-width: 420px;
        max-height: 85%;
        overflow-y: auto;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.borderBright};
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 20px 50px rgba(100,116,139,0.28), inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(148,163,184,0.12);
        position: relative;
      }
      .qt-overlay-close {
        position: absolute;
        top: 12px; right: 12px;
        width: 28px; height: 28px;
        border-radius: 50%;
        border: 1px solid ${QT_COLORS.border};
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        color: ${QT_COLORS.textSub};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(100,116,139,0.15), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .qt-overlay-title {
        font-size: 15px;
        font-weight: 700;
        color: ${QT_COLORS.silverBright};
        margin-bottom: 16px;
        text-align: center;
        letter-spacing: 2px;
      }

      /* === 总结/变量表格：浅色内凹卡片 === */
      .qt-summary-card {
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 10px;
        box-shadow: 0 1px 4px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .qt-summary-round {
        font-size: 10px;
        color: ${QT_COLORS.accent};
        font-weight: 700;
        margin-bottom: 6px;
      }
      .qt-summary-field {
        font-size: 12px;
        color: ${QT_COLORS.textMain};
        line-height: 1.6;
        margin-bottom: 6px;
      }
      .qt-summary-field-label {
        color: ${QT_COLORS.textDim};
        font-weight: 700;
        font-size: 10px;
      }
      .qt-summary-keywords {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .qt-kw-chip {
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(59,130,246,0.1);
        color: ${QT_COLORS.accent};
        border: 1px solid ${QT_COLORS.accentDim};
      }
      .qt-var-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .qt-var-key {
        flex: 1;
        font-size: 12px;
        color: ${QT_COLORS.silver};
      }
      .qt-var-input {
        flex: 1.5;
        background: ${QT_COLORS.bgInset};
        border: 1px solid ${QT_COLORS.border};
        border-radius: 6px;
        padding: 6px 10px;
        color: ${QT_COLORS.textMain};
        font-size: 12px;
        outline: none;
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.14);
      }
      .qt-var-input:focus { border-color: ${QT_COLORS.accentDim}; }

      /* === 正则美化编辑器：浅色卡片 === */
      .qt-regex-row {
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 10px;
        box-shadow: 0 1px 4px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .qt-regex-row .qt-form-group { margin-bottom: 8px; }

      /* === 内置美化：拟物手机气泡 === */
      .qt-phone-bubble {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 10px 0;
        padding: 10px 12px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 14px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.16), inset 0 1px 0 rgba(255,255,255,0.95);
      }
      .qt-phone-bubble img,
      .qt-phone-avatar-placeholder {
        width: 32px; height: 32px;
        border-radius: 50%;
        flex-shrink: 0;
        border: 1px solid ${QT_COLORS.border};
        object-fit: cover;
        box-shadow: 0 1px 3px rgba(100,116,139,0.15);
      }
      .qt-phone-avatar-placeholder {
        background: ${QT_COLORS.bgInset};
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.15);
      }
      .qt-phone-content { flex: 1; min-width: 0; }
      .qt-phone-sender {
        font-size: 11px;
        font-weight: 700;
        color: ${QT_COLORS.accent};
        margin-bottom: 3px;
      }
      .qt-phone-msg {
        font-size: 13px;
        color: ${QT_COLORS.textMain};
        line-height: 1.6;
        word-break: break-word;
      }

      /* === 内置美化：状态栏（好感度/兴奋值/心声）=== */
      .qt-status-bar {
        margin: 12px 0 6px;
        padding: 12px 14px;
        background: linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid});
        border: 1px solid ${QT_COLORS.border};
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(100,116,139,0.14), inset 0 1px 0 rgba(255,255,255,0.95);
      }
      .qt-status-npc {
        font-size: 12px;
        font-weight: 700;
        color: ${QT_COLORS.silverBright};
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid ${QT_COLORS.border};
        letter-spacing: 1px;
      }
      .qt-status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 11px;
      }
      .qt-status-label {
        width: 48px;
        flex-shrink: 0;
        color: ${QT_COLORS.textSub};
        font-weight: 600;
      }
      .qt-status-meter {
        flex: 1;
        height: 8px;
        background: ${QT_COLORS.bgInset};
        border-radius: 4px;
        overflow: hidden;
        box-shadow: inset 0 1px 2px rgba(100,116,139,0.2);
      }
      .qt-status-fill {
        height: 100%;
        background: linear-gradient(90deg, ${QT_COLORS.accent}, #60a5fa);
        border-radius: 4px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.4);
        transition: width 0.4s ease;
      }
      .qt-status-fill-excited {
        background: linear-gradient(90deg, #f59e0b, #fbbf24);
      }
      .qt-status-val {
        width: 32px;
        text-align: right;
        color: ${QT_COLORS.silver};
        font-weight: 700;
        flex-shrink: 0;
      }
      .qt-status-thought { align-items: flex-start; }
      .qt-status-thought-text {
        flex: 1;
        color: ${QT_COLORS.silverDim};
        font-style: italic;
        line-height: 1.5;
      }

      @keyframes qt-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 1. SVG 图标库（性冷淡科技风，无 emoji）
  // ============================================================
  const QT_ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>',
    task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    current: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    beautify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22a10 10 0 0 1 0-20"/></svg>',
    story: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    variable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    engine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
    network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="13" x2="6" y2="17"/><line x1="12" y1="13" x2="18" y2="17"/></svg>',
    finish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  // ============================================================
  // 2. 状态管理与辅助函数
  // ============================================================
  let qtInitialized = false;
  let qtCurrentView = 'home'; // home | wizard | system | tasks | current | beautify | game
  let qtCurrentGameId = null;
  let qtGameLiveMode = 'off'; // 弹幕三态：'off'(红/关闭) | 'green'(绿/随AI输出) | 'blue'(蓝/每轮单独调用)
  let qtDanmakuTimer = null;
  let qtCurrentBeautify = null; // 当前剧本挂载的美化套件

  function qtEscape(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function qtToast(msg) {
    let t = document.getElementById('qt-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'qt-toast';
      t.style.cssText = 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);background:linear-gradient(180deg,#ffffff,#eef1f6);color:#1e293b;padding:10px 20px;border-radius:12px;font-size:12px;z-index:100;backdrop-filter:blur(12px);border:1px solid rgba(148,163,184,0.28);box-shadow:0 8px 24px rgba(100,116,139,0.25),inset 0 1px 0 rgba(255,255,255,0.95);opacity:0;transition:opacity 0.3s;pointer-events:none;max-width:80%;text-align:center;';
      document.getElementById('qt-body').appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  async function qtGetApi() {
    try {
      const presetId = localStorage.getItem('global_api_preset_id');
      if (!presetId) return null;
      const api = await db.api_presets.get(Number(presetId));
      if (!api || !api.url || !api.key) return null;
      return { url: api.url.replace(/\/$/, ''), key: api.key, model: api.model || 'gpt-4o-mini' };
    } catch (e) { return null; }
  }

  async function qtCallAI(messages, options) {
    options = options || {};
    const api = await qtGetApi();
    if (!api) throw new Error('未配置全局 API，请前往系统设置配置');
    const body = {
      model: api.model,
      messages: messages,
      temperature: options.temperature != null ? options.temperature : 0.85
    };
    // 仅在显式指定 max_tokens 时才传，避免截断 AI 返回（让 API 用模型默认上限）
    if (options.max_tokens != null) body.max_tokens = options.max_tokens;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
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
    } finally { clearTimeout(timeoutId); }
  }

  // 容错 JSON 解析（剥离 ```json 代码块）
  function qtParseJSON(content, defaults) {
    let raw = String(content || '');
    const fenceM = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceM && fenceM[1]) raw = fenceM[1];
    const jsonM = raw.match(/\{[\s\S]*\}/);
    if (jsonM) {
      try { return JSON.parse(jsonM[0]); } catch (_) {}
    }
    try { return JSON.parse(raw); } catch (_) {}
    return Object.assign({}, defaults || {});
  }

  // 打字机动画
  function qtTyping(el, text, speed, onDone) {
    speed = speed || 35;
    el.innerHTML = '';
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'qt-typing-cursor';
    el.appendChild(cursor);
    const timer = setInterval(() => {
      if (i < text.length) {
        cursor.insertAdjacentText('beforebegin', text[i]);
        i++;
      } else {
        clearInterval(timer);
        cursor.remove();
        if (onDone) onDone();
      }
    }, speed);
    return timer;
  }

  // ============================================================
  // 3. 初始化入口
  // ============================================================
  window.initQuickTravelApp = function () {
    if (qtInitialized) { qtRenderCurrent(); return; }
    injectQuickTravelStyles();
    // 绑定关闭按钮
    const closeBtn = document.querySelector('#win-quicktravel .qt-close-btn');
    if (closeBtn) closeBtn.onclick = () => closeApp('quicktravel');
    // 加载持久化的系统性格偏好
    try {
      const savedPersona = localStorage.getItem('qt_sys_personality');
      if (savedPersona && QT_SYS_PERSONALITIES[savedPersona]) {
        qtSysBallState.personality = savedPersona;
      }
    } catch (e) {}
    qtInitialized = true;
    qtRoute();
  };

  function qtRoute() {
    const body = document.getElementById('qt-body');
    if (!body) return;
    // 先检查是否已设定身份
    db.qt_identity.toArray().then(identities => {
      if (identities.length === 0) {
        qtCurrentView = 'wizard';
      } else if (qtCurrentView === 'home' || qtCurrentView === 'wizard') {
        qtCurrentView = 'home';
      }
      qtRenderCurrent();
    });
  }

  function qtRenderCurrent() {
    switch (qtCurrentView) {
      case 'wizard': qtRenderWizard(); break;
      case 'home': qtRenderHome(); break;
      case 'system': qtRenderSystemSpace(); break;
      case 'tasks': qtRenderTasks(); break;
      case 'current': qtRenderCurrentGames(); break;
      case 'beautify': qtRenderBeautify(); break;
      case 'game': qtRenderGame(); break;
      default: qtRenderHome();
    }
  }

  function qtSetView(view) {
    qtCurrentView = view;
    qtRenderCurrent();
  }

  // ============================================================
  // 4. 身份认定向导（步进式，打字动画引导）
  // ============================================================
  let wizardStep = 0;
  let wizardData = { name: '', age: '', appearance: '', background: '', avatar: '' };
  let typingTimer = null;

  async function qtRenderWizard() {
    const body = document.getElementById('qt-body');
    const steps = [
      { key: 'name', label: '姓名', guide: '欢迎来到快穿局。\n首先，请告诉我你的姓名。\n这将是你在各个世界中的身份标识。', placeholder: '输入你的姓名' },
      { key: 'age', label: '年龄', guide: '很好。\n接下来，请设定你的年龄。\n不同世界可能会有变化，但这是你的初始设定。', placeholder: '输入年龄' },
      { key: 'appearance', label: '外貌特征', guide: '现在，请描述你的外貌特征。\n包括发型、眼瞳、身材、肤色等。\n这决定了你在文游中的形象。', placeholder: '描述外貌特征', textarea: true },
      { key: 'background', label: '身份背景', guide: '最后，请设定你的身份背景。\n你的来历、职业、性格基调。\n这是你穿越各个世界的根基。', placeholder: '描述身份背景', textarea: true }
    ];

    body.innerHTML = `
      <div id="qt-wizard">
        <div class="qt-wizard-step-indicator">
          ${[0,1,2,3].map(i => `<div class="qt-step-dot ${i === wizardStep ? 'active' : (i < wizardStep ? 'done' : '')}"></div>`).join('')}
        </div>
        <div class="qt-wizard-title">身份认定 · 第 ${wizardStep + 1} 步</div>
        <div class="qt-typing-text" id="qt-typing-area"></div>
        <div id="qt-wizard-input-area"></div>
        <div class="qt-wizard-actions">
          ${wizardStep > 0 ? '<button class="qt-btn" id="qt-wizard-prev">上一步</button>' : ''}
          <button class="qt-btn qt-btn-primary" id="qt-wizard-next">${wizardStep < 3 ? '下一步' : '完成认定'}</button>
        </div>
        <div style="margin-top:20px; text-align:center;">
          <button class="qt-btn" id="qt-wizard-import" style="font-size:11px;">从档案库导入身份</button>
        </div>
      </div>
    `;

    // 打字动画引导
    const typingArea = document.getElementById('qt-typing-area');
    if (typingTimer) clearInterval(typingTimer);
    typingTimer = qtTyping(typingArea, steps[wizardStep].guide, 30, () => {
      // 打字完成后显示输入框
      const inputArea = document.getElementById('qt-wizard-input-area');
      if (!inputArea) return;
      const val = wizardData[steps[wizardStep].key] || '';
      if (steps[wizardStep].textarea) {
        inputArea.innerHTML = `<textarea class="qt-wizard-input" id="qt-wizard-field" placeholder="${steps[wizardStep].placeholder}" rows="4">${qtEscape(val)}</textarea>`;
      } else {
        inputArea.innerHTML = `<input type="text" class="qt-wizard-input" id="qt-wizard-field" placeholder="${steps[wizardStep].placeholder}" value="${qtEscape(val)}">`;
      }
      const field = document.getElementById('qt-wizard-field');
      if (field) field.focus();
    });

    // 上一步
    const prevBtn = document.getElementById('qt-wizard-prev');
    if (prevBtn) prevBtn.onclick = () => {
      // 保存当前
      const f = document.getElementById('qt-wizard-field');
      if (f) wizardData[steps[wizardStep].key] = f.value.trim();
      wizardStep--;
      qtRenderWizard();
    };

    // 下一步/完成
    const nextBtn = document.getElementById('qt-wizard-next');
    if (nextBtn) nextBtn.onclick = async () => {
      const f = document.getElementById('qt-wizard-field');
      if (f) wizardData[steps[wizardStep].key] = f.value.trim();
      if (!wizardData[steps[wizardStep].key]) { qtToast('请填写' + steps[wizardStep].label); return; }
      if (wizardStep < 3) {
        wizardStep++;
        qtRenderWizard();
      } else {
        // 完成认定，写入数据库
        await db.qt_identity.add({
          name: wizardData.name,
          age: wizardData.age,
          appearance: wizardData.appearance,
          background: wizardData.background,
          avatar: wizardData.avatar || '',
          createdAt: Date.now()
        });
        qtToast('身份认定完成，欢迎加入快穿局');
        qtCurrentView = 'home';
        setTimeout(() => qtRenderCurrent(), 500);
      }
    };

    // 从档案库导入
    const importBtn = document.getElementById('qt-wizard-import');
    if (importBtn) importBtn.onclick = () => qtOpenArchiveSelector();
  }

  // 从档案库选择身份
  async function qtOpenArchiveSelector() {
    let archives = [];
    try { archives = await db.archives.where('type').anyOf(['user', 'character']).toArray(); } catch (e) {}
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">从档案库导入身份</div>';
    if (archives.length === 0) {
      html += '<div style="text-align:center; color:' + QT_COLORS.textSub + '; padding:20px; font-size:12px;">档案库中暂无角色</div>';
    } else {
      html += '<div class="qt-archive-selector">';
      archives.forEach(a => {
        const avatar = a.avatar || '';
        const name = qtEscape(a.name || '未命名');
        const note = qtEscape(a.description || a.persona || '');
        html += `<div class="qt-archive-option" data-archive-id="${a.id}">
          ${avatar ? `<img src="${avatar}" onerror="this.style.display='none'">` : '<div style="width:36px;height:36px;border-radius:50%;background:' + QT_COLORS.bgMid + ';border:1px solid ' + QT_COLORS.border + ';box-shadow:inset 0 1px 2px rgba(100,116,139,0.15);"></div>'}
          <div class="qt-archive-option-info">
            <div class="qt-archive-option-name">${name}</div>
            ${note ? '<div class="qt-archive-option-note">' + note + '</div>' : ''}
          </div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    overlay.querySelectorAll('.qt-archive-option').forEach(opt => {
      opt.onclick = async () => {
        const id = parseInt(opt.getAttribute('data-archive-id'));
        const a = await db.archives.get(id);
        if (a) {
          wizardData.name = a.name || '';
          wizardData.age = a.age || '';
          wizardData.appearance = a.appearance || a.description || '';
          wizardData.background = a.persona || a.background || '';
          wizardData.avatar = a.avatar || '';
          // 直接写入
          await db.qt_identity.add({
            name: wizardData.name, age: wizardData.age,
            appearance: wizardData.appearance, background: wizardData.background,
            avatar: wizardData.avatar, createdAt: Date.now()
          });
          overlay.classList.remove('active');
          qtToast('身份导入成功');
          qtCurrentView = 'home';
          setTimeout(() => qtRenderCurrent(), 400);
        }
      };
    });
  }

  // ============================================================
  // 5. 主页：5 个形状入口
  // ============================================================
  async function qtRenderHome() {
    const body = document.getElementById('qt-body');
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = '快穿局';

    // 统计进行中剧本数
    let activeGames = [];
    let completedWorlds = [];
    let worldviews = [];
    try {
      activeGames = await db.qt_games.where('status').equals('active').toArray();
      completedWorlds = await db.qt_games.where('status').equals('completed').toArray();
      worldviews = await db.qt_worldviews.toArray();
    } catch (e) {}

    body.innerHTML = `
      <div id="qt-home">
        <div class="qt-home-header">
          <div class="qt-home-title">QUICK TRAVEL</div>
          <div class="qt-home-sub">快穿局 · 时空穿越管理局</div>
        </div>
        <div class="qt-entrances">
          <div class="qt-entrance qt-entrance-shape-1" data-go="system">
            ${QT_ICONS.system}
            <div class="qt-entrance-name">系统空间</div>
          </div>
          <div class="qt-entrance qt-entrance-shape-2" data-go="tasks">
            ${QT_ICONS.task}
            <div class="qt-entrance-name">领任务</div>
            ${worldviews.length > 0 ? `<div class="qt-entrance-badge">${worldviews.length}</div>` : ''}
          </div>
          <div class="qt-entrance qt-entrance-shape-3" data-go="current">
            ${QT_ICONS.current}
            <div class="qt-entrance-name">当前任务</div>
            ${activeGames.length > 0 ? `<div class="qt-entrance-badge">${activeGames.length}</div>` : ''}
          </div>
          <div class="qt-entrance qt-entrance-shape-4" data-go="beautify">
            ${QT_ICONS.beautify}
            <div class="qt-entrance-name">美化</div>
          </div>
        </div>
        <!-- 进行中剧本块 -->
        <div class="qt-card qt-card-hover" style="cursor:pointer;" id="qt-active-block-btn">
          <div class="qt-section-title">${QT_ICONS.story}正在进行中的剧本</div>
          ${activeGames.length === 0
            ? '<div style="color:' + QT_COLORS.textSub + '; font-size:12px; padding:8px 0;">暂无进行中的剧本，前往领任务开始穿越</div>'
            : '<div class="qt-active-list">' + activeGames.map(g => `<div class="qt-active-chip" data-game-id="${g.id}">${qtEscape(g.title || '未命名剧本')}</div>`).join('') + '</div>'
          }
        </div>
        <!-- 已完结世界 -->
        <div class="qt-card" style="margin-top:12px;">
          <div class="qt-section-title">${QT_ICONS.book}已完结世界 (${completedWorlds.length})</div>
          <div style="color:${QT_COLORS.textSub}; font-size:12px;">${completedWorlds.length === 0 ? '尚未完结任何世界' : '前往系统空间查看完整记录'}</div>
        </div>
      </div>
    `;

    // 绑定入口
    body.querySelectorAll('[data-go]').forEach(el => {
      el.onclick = () => qtSetView(el.getAttribute('data-go'));
    });
    // 进行中剧本块点击
    const activeBlock = document.getElementById('qt-active-block-btn');
    if (activeBlock) activeBlock.onclick = (e) => {
      const chip = e.target.closest('[data-game-id]');
      if (chip) {
        qtCurrentGameId = parseInt(chip.getAttribute('data-game-id'));
        qtSetView('game');
      } else {
        qtSetView('current');
      }
    };
  }

  // ============================================================
  // 6. 系统空间：身份信息（可折叠）+ 已完结世界（漂浮书本）
  // ============================================================
  async function qtRenderSystemSpace() {
    const body = document.getElementById('qt-body');
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = '系统空间';

    let identity = null;
    let completedGames = [];
    try {
      identity = await db.qt_identity.toCollection().first();
      completedGames = await db.qt_games.where('status').equals('completed').toArray();
    } catch (e) {}

    let html = '<div class="qt-panel">';
    // 返回按钮
    html += `<div style="margin-bottom:16px;"><button class="qt-btn qt-btn-icon" onclick="window.qtSetViewPublic('home')">${QT_ICONS.back}</button></div>`;

    // 身份信息折叠卡
    if (identity) {
      html += '<div class="qt-card qt-identity-fold" id="qt-id-fold">';
      html += '<div class="qt-identity-fold-header">';
      html += '<div class="qt-section-title" style="margin:0;">' + QT_ICONS.user + ' 当前身份信息</div>';
      html += '<span class="qt-identity-fold-arrow">' + QT_ICONS.arrow + '</span>';
      html += '</div>';
      html += '<div class="qt-identity-body">';
      html += `<div class="qt-identity-row"><div class="qt-identity-label">姓名</div><div class="qt-identity-value">${qtEscape(identity.name)}</div></div>`;
      html += `<div class="qt-identity-row"><div class="qt-identity-label">年龄</div><div class="qt-identity-value">${qtEscape(identity.age || '未设定')}</div></div>`;
      html += `<div class="qt-identity-row"><div class="qt-identity-label">外貌</div><div class="qt-identity-value">${qtEscape(identity.appearance || '未设定')}</div></div>`;
      html += `<div class="qt-identity-row"><div class="qt-identity-label">背景</div><div class="qt-identity-value">${qtEscape(identity.background || '未设定')}</div></div>`;
      html += `<div style="margin-top:12px;"><button class="qt-btn" id="qt-id-edit">编辑身份</button>
               <button class="qt-btn qt-btn-danger" id="qt-id-reset" style="margin-left:8px;">重新认定</button></div>`;
      html += '</div></div>';
    }

    // 系统选择卡（选择系统性格，可折叠）
    html += '<div class="qt-card qt-identity-fold" id="qt-persona-fold">';
    html += '<div class="qt-identity-fold-header">';
    html += '<div class="qt-section-title" style="margin:0;">' + (QT_ICONS.engine || '⚙') + ' 系统选择</div>';
    html += '<span class="qt-identity-fold-arrow">' + QT_ICONS.arrow + '</span>';
    html += '</div>';
    html += '<div class="qt-identity-body">';
    html += '<div style="font-size:11px; color:' + QT_COLORS.textSub + '; margin-bottom:10px;">选择系统的基本性格，影响系统小球的发言语气</div>';
    const curPersona = qtSysBallState.personality || 'tsundere';
    html += '<div id="qt-persona-list" style="display:flex; flex-direction:column; gap:6px;">';
    for (const key of QT_SYS_PERSONALITY_KEYS) {
      const p = QT_SYS_PERSONALITIES[key];
      const sel = key === curPersona;
      html += `<div class="qt-mount-option${sel ? ' selected' : ''}" data-persona="${key}" style="cursor:pointer;">
        <span class="qt-mount-radio${sel ? ' selected' : ''}"></span>
        <div style="font-size:12px; font-weight:600; color:${QT_COLORS.silver};">${qtEscape(p.name)}</div>
      </div>`;
    }
    html += '</div></div></div>';

    // 已完结世界（漂浮书本图标）
    html += '<div class="qt-card">';
    html += '<div class="qt-section-title">' + QT_ICONS.book + '已完结世界 (' + completedGames.length + ')</div>';
    if (completedGames.length === 0) {
      html += '<div style="color:' + QT_COLORS.textSub + '; font-size:12px; padding:12px 0; text-align:center;">尚未完结任何世界</div>';
    } else {
      html += '<div class="qt-book-shelf">';
      for (const g of completedGames) {
        let wv = null;
        try { wv = await db.qt_worldviews.get(g.worldviewId); } catch (e) {}
        html += `<div class="qt-book" data-game-id="${g.id}" title="${qtEscape(g.title)}">
          <div class="qt-book-title">${qtEscape(g.title || (wv ? wv.title : '未命名'))}</div>
          <div class="qt-book-status">已完结</div>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    body.innerHTML = html;

    // 折叠
    const fold = document.getElementById('qt-id-fold');
    if (fold) fold.querySelector('.qt-identity-fold-header').onclick = () => fold.classList.toggle('open');

    // 系统选择卡折叠
    const personaFold = document.getElementById('qt-persona-fold');
    if (personaFold) personaFold.querySelector('.qt-identity-fold-header').onclick = () => personaFold.classList.toggle('open');

    // 系统性格选择
    body.querySelectorAll('#qt-persona-list .qt-mount-option').forEach(opt => {
      opt.onclick = () => {
        const key = opt.getAttribute('data-persona');
        qtSysBallState.personality = key;
        // 持久化到 localStorage（系统性格为应用级偏好）
        try { localStorage.setItem('qt_sys_personality', key); } catch (e) {}
        // 更新选中态
        body.querySelectorAll('#qt-persona-list .qt-mount-option').forEach(o => {
          o.classList.remove('selected');
          o.querySelector('.qt-mount-radio').classList.remove('selected');
        });
        opt.classList.add('selected');
        opt.querySelector('.qt-mount-radio').classList.add('selected');
        qtToast('系统性格已切换为：' + (QT_SYS_PERSONALITIES[key] ? QT_SYS_PERSONALITIES[key].name : key));
      };
    });

    // 编辑身份
    const editBtn = document.getElementById('qt-id-edit');
    if (editBtn) editBtn.onclick = () => qtEditIdentity(identity);

    // 重新认定
    const resetBtn = document.getElementById('qt-id-reset');
    if (resetBtn) resetBtn.onclick = async () => {
      if (!confirm('确定要重新认定身份吗？当前身份将被清除。')) return;
      await db.qt_identity.clear();
      wizardStep = 0;
      wizardData = { name: '', age: '', appearance: '', background: '', avatar: '' };
      qtCurrentView = 'wizard';
      qtRenderCurrent();
    };

    // 书本点击
    body.querySelectorAll('[data-game-id]').forEach(book => {
      book.onclick = async () => {
        const gid = parseInt(book.getAttribute('data-game-id'));
        const g = await db.qt_games.get(gid);
        if (g) qtOpenCompletedGameDetail(g);
      };
    });
  }

  async function qtEditIdentity(identity) {
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">编辑身份</div>';
    html += `<div class="qt-form-group"><label class="qt-form-label">姓名</label><input class="qt-form-input" id="qt-edit-name" value="${qtEscape(identity.name || '')}"></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">年龄</label><input class="qt-form-input" id="qt-edit-age" value="${qtEscape(identity.age || '')}"></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">外貌特征</label><textarea class="qt-form-input" id="qt-edit-appearance" rows="3">${qtEscape(identity.appearance || '')}</textarea></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">身份背景</label><textarea class="qt-form-input" id="qt-edit-background" rows="3">${qtEscape(identity.background || '')}</textarea></div>`;
    html += '<button class="qt-btn qt-btn-primary" id="qt-edit-save" style="width:100%;">保存</button>';
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('qt-edit-save').onclick = async () => {
      await db.qt_identity.update(identity.id, {
        name: document.getElementById('qt-edit-name').value.trim(),
        age: document.getElementById('qt-edit-age').value.trim(),
        appearance: document.getElementById('qt-edit-appearance').value.trim(),
        background: document.getElementById('qt-edit-background').value.trim()
      });
      overlay.classList.remove('active');
      qtToast('身份已更新');
      qtRenderSystemSpace();
    };
  }

  async function qtOpenCompletedGameDetail(game) {
    const overlay = document.getElementById('qt-overlay');
    let wv = null;
    try { wv = await db.qt_worldviews.get(game.worldviewId); } catch (e) {}
    let msgCount = 0;
    try { msgCount = await db.qt_messages.where('gameId').equals(game.id).count(); } catch (e) {}
    let html = '<div class="qt-overlay-card">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">' + qtEscape(game.title || '未命名') + '</div>';
    html += `<div style="font-size:12px; color:${QT_COLORS.textSub}; line-height:1.8;">
      <div>总轮数：${game.currentRound || 0}</div>
      <div>消息数：${msgCount}</div>
      ${wv ? '<div>世界观：' + qtEscape(wv.title) + '</div>' : ''}
    </div>`;
    html += `<div style="margin-top:16px; display:flex; gap:8px;">
      <button class="qt-btn qt-btn-danger" id="qt-del-completed" style="flex:1;">删除记录</button>
    </div>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('qt-del-completed').onclick = async () => {
      if (!confirm('确定删除此完结记录？相关消息和总结也将被删除。')) return;
      await db.qt_games.delete(game.id);
      await db.qt_messages.where('gameId').equals(game.id).delete();
      await db.qt_summaries.where('gameId').equals(game.id).delete();
      await db.qt_variables.where('gameId').equals(game.id).delete();
      overlay.classList.remove('active');
      qtToast('已删除');
      qtRenderSystemSpace();
    };
  }

  // ============================================================
  // 7. 领任务：世界观列表（AI 生成/导入导出/编辑删除/进入游戏）
  // ============================================================
  async function qtRenderTasks() {
    const body = document.getElementById('qt-body');
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = '领任务';

    let worldviews = [];
    try { worldviews = await db.qt_worldviews.toArray(); } catch (e) {}

    let html = '<div class="qt-panel">';
    html += `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <button class="qt-btn qt-btn-icon" onclick="window.qtSetViewPublic('home')">${QT_ICONS.back}</button>
      <div style="display:flex; gap:8px;">
        <button class="qt-btn" id="qt-wv-import">${QT_ICONS.import}导入</button>
        <button class="qt-btn qt-btn-primary" id="qt-wv-new">${QT_ICONS.plus}新建世界观</button>
      </div>
    </div>`;

    if (worldviews.length === 0) {
      html += `<div class="qt-card" style="text-align:center; padding:40px;">
        <div style="color:${QT_COLORS.textSub}; font-size:13px; margin-bottom:16px;">暂无世界观，点击右上角新建或导入</div>
      </div>`;
    } else {
      for (const wv of worldviews) {
        const charCount = Array.isArray(wv.characters) ? wv.characters.length : 0;
        html += `<div class="qt-worldview-card" data-wv-id="${wv.id}">
          <div class="qt-wv-title">${qtEscape(wv.title || '未命名世界观')}</div>
          <div class="qt-wv-synopsis">${qtEscape(wv.synopsis || '暂无剧情梗概')}</div>
          <div class="qt-wv-meta">
            <span class="qt-wv-tag">${charCount} 个角色</span>
            ${wv.source === 'ai' ? '<span class="qt-wv-tag">AI 生成</span>' : ''}
            ${wv.source === 'import' ? '<span class="qt-wv-tag">导入</span>' : ''}
          </div>
          <div class="qt-wv-actions">
            <button class="qt-btn qt-btn-primary" data-action="play" data-wv-id="${wv.id}">${QT_ICONS.play}进入游戏</button>
            <button class="qt-btn" data-action="view" data-wv-id="${wv.id}">查看</button>
            <button class="qt-btn" data-action="edit" data-wv-id="${wv.id}">${QT_ICONS.edit}编辑</button>
            <button class="qt-btn" data-action="export" data-wv-id="${wv.id}">${QT_ICONS.export}导出</button>
            <button class="qt-btn qt-btn-danger" data-action="delete" data-wv-id="${wv.id}">${QT_ICONS.trash}</button>
          </div>
        </div>`;
      }
    }
    html += '</div>';
    body.innerHTML = html;

    // 绑定事件
    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = parseInt(btn.getAttribute('data-wv-id'));
        if (action === 'play') qtStartGame(id);
        else if (action === 'view') qtViewWorldview(id);
        else if (action === 'edit') qtEditWorldview(id);
        else if (action === 'export') qtExportWorldview(id);
        else if (action === 'delete') qtDeleteWorldview(id);
      };
    });

    // 新建
    document.getElementById('qt-wv-new').onclick = () => qtEditWorldview(null);
    // 导入
    document.getElementById('qt-wv-import').onclick = () => qtImportWorldview();
  }

  // 新建/编辑世界观（含 AI 生成）
  async function qtEditWorldview(id) {
    let wv = null;
    if (id != null) {
      try { wv = await db.qt_worldviews.get(id); } catch (e) {}
    }
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card" style="max-width:460px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">' + (wv ? '编辑世界观' : '新建世界观') + '</div>';

    html += `<div class="qt-form-group"><label class="qt-form-label">标题</label><input class="qt-form-input" id="qt-wv-title" value="${wv ? qtEscape(wv.title) : ''}" placeholder="如：长安十二时辰"></div>`;

    html += `<div class="qt-form-group"><label class="qt-form-label">生成要求（输入要求后点击 AI 生成，自动填充以下字段）</label>
      <textarea class="qt-form-input" id="qt-wv-prompt" rows="2" placeholder="如：一个古代宫斗世界，主角是失势的世家女子">${wv && wv.genPrompt ? qtEscape(wv.genPrompt) : ''}</textarea></div>`;

    // 世界背景
    html += '<div class="qt-accordion" id="qt-acc-bg">';
    html += '<div class="qt-accordion-header"><span>世界背景</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>';
    html += '<div class="qt-accordion-body">';
    html += `<textarea class="qt-form-input" id="qt-wv-bg" rows="3" placeholder="世界背景设定">${wv ? qtEscape(wv.worldBackground || '') : ''}</textarea>`;
    html += '</div></div>';

    // 世界书：手风琴式选择框（每个条目为可展开的子手风琴，可勾选引用）
    html += '<div class="qt-accordion" id="qt-acc-worldbook">';
    html += '<div class="qt-accordion-header"><span>' + QT_ICONS.book + '世界书（手风琴式选择）</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>';
    html += '<div class="qt-accordion-body">';
    html += '<div id="qt-wb-accordion-list" style="display:flex; flex-direction:column; gap:6px;"></div>';
    html += `<div style="display:flex; gap:8px; margin-top:10px;">
      <button class="qt-btn" id="qt-wb-quote-selected" style="flex:1; font-size:11px;">引用选中到世界背景</button>
      <button class="qt-btn" id="qt-wb-clear-selected" style="flex:1; font-size:11px;">清空选择</button>
    </div>`;
    html += '</div></div>';

    // 主要人物：可从档案库导入
    html += '<div class="qt-accordion" id="qt-acc-chars">';
    html += '<div class="qt-accordion-header"><span>主要人物</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>';
    html += '<div class="qt-accordion-body">';
    html += `<textarea class="qt-form-input" id="qt-wv-chars" rows="4" placeholder="每行一个角色，格式：姓名: 身份描述&#10;如：李白: 诗仙，潇洒不羁">${wv && wv.characters ? qtEscape(typeof wv.characters === 'string' ? wv.characters : (Array.isArray(wv.characters) ? wv.characters.map(c => (c.name || '') + ': ' + (c.identity || '')).join('\n') : '')) : ''}</textarea>`;
    html += '<button class="qt-btn" id="qt-wv-import-chars" style="margin-top:8px; font-size:11px;">从档案库导入角色</button>';
    html += '</div></div>';

    // 关系网
    html += '<div class="qt-accordion" id="qt-acc-rel">';
    html += '<div class="qt-accordion-header"><span>关系网</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>';
    html += '<div class="qt-accordion-body">';
    html += `<textarea class="qt-form-input" id="qt-wv-rel" rows="4" placeholder="人物关系网（文本描述）">${wv ? qtEscape(wv.relationships || '') : ''}</textarea>`;
    html += '</div></div>';

    // 剧情梗概
    html += `<div class="qt-form-group"><label class="qt-form-label">剧情梗概</label><textarea class="qt-form-input" id="qt-wv-syn" rows="3" placeholder="原文剧情梗概">${wv ? qtEscape(wv.synopsis || '') : ''}</textarea></div>`;

    // 开场白（手风琴式，每个独立文本框，可增删多个；留空则由 AI 自动生成）
    html += `<div class="qt-form-group"><label class="qt-form-label">开场白（手风琴式，可添加多个；留空则由 AI 自动生成）</label><div id="qt-openings-list" style="display:flex; flex-direction:column; gap:8px;"></div><button class="qt-btn" id="qt-opening-add" style="width:100%; margin-top:8px;">${QT_ICONS.plus || '+'} 添加开场白</button></div>`;

    html += `<div style="display:flex; gap:8px; margin-top:16px;">
      <button class="qt-btn" id="qt-wv-ai" style="flex:1;">${QT_ICONS.engine}AI 生成</button>
      <button class="qt-btn qt-btn-primary" id="qt-wv-save" style="flex:1;">保存</button>
    </div>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    // 手风琴
    overlay.querySelectorAll('.qt-accordion-header').forEach(h => {
      h.onclick = () => h.parentElement.classList.toggle('open');
    });

    // 开场白手风琴列表（每个独立文本框，可增删）
    const openingsList = document.getElementById('qt-openings-list');
    const existingOpenings = (wv && Array.isArray(wv.openings)) ? wv.openings : [''];
    const qtRenderOpeningItem = (val) => {
      const idx = openingsList.children.length;
      const acc = document.createElement('div');
      acc.className = 'qt-accordion open';
      acc.innerHTML = '<div class="qt-accordion-header"><span>开场白 ' + (idx + 1) + '</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>' +
        '<div class="qt-accordion-body">' +
        '<textarea class="qt-form-input qt-opening-text" rows="4" placeholder="如：你睁开眼，发现自己身处一座古色古香的庭院…">' + qtEscape(val || '') + '</textarea>' +
        '<button class="qt-btn qt-opening-del" style="margin-top:6px; width:100%; color:' + QT_COLORS.danger + ';">删除此开场白</button>' +
        '</div>';
      acc.querySelector('.qt-accordion-header').onclick = () => acc.classList.toggle('open');
      acc.querySelector('.qt-opening-del').onclick = () => { acc.remove(); qtRefreshOpeningLabels(); };
      openingsList.appendChild(acc);
    };
    const qtRefreshOpeningLabels = () => {
      openingsList.querySelectorAll('.qt-accordion').forEach((acc, i) => {
        const span = acc.querySelector('.qt-accordion-header > span:first-child');
        if (span) span.textContent = '开场白 ' + (i + 1);
      });
    };
    existingOpenings.forEach(v => qtRenderOpeningItem(v));
    document.getElementById('qt-opening-add').onclick = () => {
      qtRenderOpeningItem('');
      openingsList.lastElementChild && openingsList.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    // 加载世界书列表：四层手风琴（容器 → 分组 → 条目 → 内容），按 group 分组
    const qtWbSelected = new Set();
    try {
      const wbs = await db.world_book_entries.toArray();
      const wbList = document.getElementById('qt-wb-accordion-list');
      if (wbList) {
        if (wbs.length === 0) {
          wbList.innerHTML = '<div style="font-size:11px; color:' + QT_COLORS.textDim + '; text-align:center; padding:12px;">暂无世界书条目</div>';
        } else {
          // 按 group 分组（无 group 归到"未分组"）
          const groupMap = new Map();
          wbs.forEach(wb => {
            const g = wb.group || '未分组';
            if (!groupMap.has(g)) groupMap.set(g, []);
            groupMap.get(g).push(wb);
          });
          // 逐分组渲染（第二层手风琴）
          groupMap.forEach((entries, groupName) => {
            const groupAcc = document.createElement('div');
            groupAcc.className = 'qt-accordion';
            groupAcc.innerHTML = '<div class="qt-accordion-header"><span>' + QT_ICONS.book + qtEscape(groupName) + ' (' + entries.length + ')</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>' +
              '<div class="qt-accordion-body" style="display:flex; flex-direction:column; gap:6px;"></div>';
            const groupBody = groupAcc.querySelector('.qt-accordion-body');
            groupAcc.querySelector('.qt-accordion-header').onclick = () => groupAcc.classList.toggle('open');
            // 逐条目渲染（第三层手风琴）
            entries.forEach(wb => {
              const wid = wb.id;
              const item = document.createElement('div');
              item.className = 'qt-wb-item';
              item.innerHTML =
                '<div class="qt-wb-item-header">' +
                  '<label class="qt-wb-check" data-wb-id="' + wid + '">' +
                    '<input type="checkbox" data-wb-id="' + wid + '">' +
                    '<span class="qt-wb-checkmark"></span>' +
                  '</label>' +
                  '<span class="qt-wb-item-title">' + qtEscape(wb.title || '未命名') + '</span>' +
                  '<span class="qt-wb-item-arrow">' + QT_ICONS.arrow + '</span>' +
                '</div>' +
                '<div class="qt-wb-item-body">' +
                  '<div class="qt-wb-item-content">' + qtEscape(wb.content || '（无内容）') + '</div>' +
                  '<button class="qt-btn qt-btn-primary" data-wb-quote="' + wid + '" style="width:100%; margin-top:8px; font-size:11px;">引用此条目到世界背景</button>' +
                '</div>';
              groupBody.appendChild(item);
              const cb = item.querySelector('input[type="checkbox"]');
              cb.onchange = (e) => {
                e.stopPropagation();
                if (cb.checked) { qtWbSelected.add(wid); item.classList.add('selected'); }
                else { qtWbSelected.delete(wid); item.classList.remove('selected'); }
              };
              item.querySelector('.qt-wb-check').onclick = (e) => e.stopPropagation();
              const header = item.querySelector('.qt-wb-item-header');
              header.onclick = (e) => {
                if (e.target.closest('.qt-wb-check')) return;
                item.classList.toggle('open');
              };
              item.querySelector('[data-wb-quote]').onclick = (e) => {
                e.stopPropagation();
                const bg = document.getElementById('qt-wv-bg');
                bg.value = (bg.value ? bg.value + '\n' : '') + '【' + (wb.title || '') + '】' + (wb.content || '');
                qtToast('已引用：' + (wb.title || ''));
              };
            });
            wbList.appendChild(groupAcc);
          });
        }
      }
      // 批量引用选中
      const quoteBtn = document.getElementById('qt-wb-quote-selected');
      if (quoteBtn) quoteBtn.onclick = async () => {
        if (qtWbSelected.size === 0) { qtToast('请先勾选世界书条目'); return; }
        const bg = document.getElementById('qt-wv-bg');
        let appended = '';
        for (const wid of qtWbSelected) {
          const wb = await db.world_book_entries.get(wid);
          if (wb) appended += '【' + (wb.title || '') + '】' + (wb.content || '') + '\n';
        }
        bg.value = (bg.value ? bg.value + '\n' : '') + appended.trim();
        qtToast('已引用 ' + qtWbSelected.size + ' 条世界书');
      };
      // 清空选择
      const clearBtn = document.getElementById('qt-wb-clear-selected');
      if (clearBtn) clearBtn.onclick = () => {
        qtWbSelected.clear();
        wbList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
        wbList.querySelectorAll('.qt-wb-item').forEach(it => it.classList.remove('selected'));
      };
    } catch (e) {}

    // 从档案库导入角色
    document.getElementById('qt-wv-import-chars').onclick = async () => {
      let archives = [];
      try { archives = await db.archives.where('type').anyOf(['character', 'npc']).toArray(); } catch (e) {}
      if (archives.length === 0) { qtToast('档案库中暂无角色'); return; }
      const charsTextarea = document.getElementById('qt-wv-chars');
      let existing = [];
      try { existing = JSON.parse(charsTextarea.value || '[]'); } catch (e) { existing = []; }
      const selected = [];
      // 简易选择：弹出列表
      const selHtml = archives.map(a => `<div class="qt-archive-option" data-a-id="${a.id}">
        ${a.avatar ? `<img src="${a.avatar}" onerror="this.style.display='none'">` : '<div style="width:36px;height:36px;border-radius:50%;background:' + QT_COLORS.bgMid + ';border:1px solid ' + QT_COLORS.border + ';box-shadow:inset 0 1px 2px rgba(100,116,139,0.15);"></div>'}
        <div class="qt-archive-option-info"><div class="qt-archive-option-name">${qtEscape(a.name)}</div></div>
      </div>`).join('');
      const selOverlay = document.createElement('div');
      selOverlay.style.cssText = 'position:absolute;inset:0;z-index:60;background:rgba(226,232,240,0.7);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;';
      selOverlay.innerHTML = '<div class="qt-overlay-card" style="max-height:70%;"><div class="qt-overlay-title">选择角色导入</div><div class="qt-archive-selector">' + selHtml + '</div><button class="qt-btn qt-btn-primary" id="qt-char-confirm" style="width:100%; margin-top:12px;">确认导入</button></div>';
      overlay.appendChild(selOverlay);
      selOverlay.querySelectorAll('[data-a-id]').forEach(o => {
        o.onclick = () => {
          o.style.borderColor = QT_COLORS.accent;
          const aid = parseInt(o.getAttribute('data-a-id'));
          if (!selected.includes(aid)) selected.push(aid);
        };
      });
      document.getElementById('qt-char-confirm').onclick = async () => {
        for (const aid of selected) {
          const a = await db.archives.get(aid);
          if (a) existing.push({ name: a.name, identity: a.persona || a.description || '', avatar: a.avatar || '' });
        }
        charsTextarea.value = JSON.stringify(existing, null, 2);
        selOverlay.remove();
      };
    };

    // AI 生成
    document.getElementById('qt-wv-ai').onclick = async () => {
      const prompt = document.getElementById('qt-wv-prompt').value.trim();
      if (!prompt) { qtToast('请输入生成要求'); return; }
      const btn = document.getElementById('qt-wv-ai');
      btn.disabled = true; btn.textContent = '生成中…';
      qtToast('正在生成世界观…');
      try {
        const result = await qtGenerateWorldview(prompt);
        if (result.title) document.getElementById('qt-wv-title').value = result.title;
        if (result.synopsis) document.getElementById('qt-wv-syn').value = result.synopsis;
        if (result.worldBackground) document.getElementById('qt-wv-bg').value = result.worldBackground;
        if (result.characters && Array.isArray(result.characters)) {
          document.getElementById('qt-wv-chars').value = result.characters.map(c => (c.name || '') + ': ' + (c.identity || '')).join('\n');
        } else if (typeof result.characters === 'string') {
          document.getElementById('qt-wv-chars').value = result.characters;
        }
        if (result.relationships) document.getElementById('qt-wv-rel').value = result.relationships;
        // 回填 AI 生成的开场白到手风琴列表
        if (result.openings && result.openings.length > 0) {
          const list = document.getElementById('qt-openings-list');
          if (list) {
            list.innerHTML = '';
            result.openings.forEach(v => {
              const idx = list.children.length;
              const acc = document.createElement('div');
              acc.className = 'qt-accordion';
              acc.innerHTML = '<div class="qt-accordion-header"><span>开场白 ' + (idx + 1) + '</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>' +
                '<div class="qt-accordion-body">' +
                '<textarea class="qt-form-input qt-opening-text" rows="4" placeholder="如：你睁开眼，发现自己身处一座古色古香的庭院…">' + qtEscape(v) + '</textarea>' +
                '<button class="qt-btn qt-opening-del" style="margin-top:6px; width:100%; color:' + QT_COLORS.danger + ';">删除此开场白</button>' +
                '</div>';
              acc.querySelector('.qt-accordion-header').onclick = () => acc.classList.toggle('open');
              acc.querySelector('.qt-opening-del').onclick = () => { acc.remove(); };
              list.appendChild(acc);
            });
          }
        }
        qtToast('世界观已生成');
      } catch (e) {
        qtToast('生成失败：' + (e.message || '未知错误'));
      }
      btn.disabled = false; btn.innerHTML = QT_ICONS.engine + 'AI 生成';
    };

    // 保存
    document.getElementById('qt-wv-save').onclick = async () => {
      const title = document.getElementById('qt-wv-title').value.trim();
      if (!title) { qtToast('请输入标题'); return; }
      let chars = [];
      const charsRaw = document.getElementById('qt-wv-chars').value.trim();
      if (charsRaw) {
        try { chars = JSON.parse(charsRaw); }
        catch (e) {
          // 非 JSON：尝试按行解析 "name: identity" 格式
          chars = charsRaw.split('\n').filter(l => l.trim()).map(line => {
            const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
            return m ? { name: m[1].trim(), identity: m[2].trim(), avatar: '' } : { name: line.trim(), identity: '', avatar: '' };
          });
        }
      }
      const data = {
        title,
        synopsis: document.getElementById('qt-wv-syn').value.trim(),
        worldBackground: document.getElementById('qt-wv-bg').value.trim(),
        characters: chars,
        relationships: document.getElementById('qt-wv-rel').value.trim(),
        genPrompt: document.getElementById('qt-wv-prompt').value.trim(),
        openings: Array.from(document.querySelectorAll('#qt-openings-list .qt-opening-text')).map(t => t.value.trim()).filter(s => s)
      };
      if (wv) {
        await db.qt_worldviews.update(wv.id, Object.assign({ source: wv.source || 'manual' }, data));
      } else {
        data.source = 'ai';
        data.createdAt = Date.now();
        await db.qt_worldviews.add(data);
      }
      overlay.classList.remove('active');
      qtToast('世界观已保存');
      qtRenderTasks();
    };
  }

  // AI 生成世界观
  async function qtGenerateWorldview(prompt) {
    const aiPrompt = `你是一个世界观生成器。请根据以下要求生成一个完整的虚构世界观，用于长文文字游戏（快穿）。

要求：${prompt}

请生成以下内容：
1. title: 世界观标题（简洁有力）
2. synopsis: 原文剧情梗概（100-200字，概括这个世界的主要剧情线索）
3. worldBackground: 世界背景设定（200-400字，包括时代、地理、社会结构、特殊规则等）
4. characters: 主要人物列表（3-6个角色，每个含 name 姓名、identity 身份描述、avatar 留空）
5. relationships: 人物关系网（文字描述各角色间的关系，如亲属/敌对/暗恋/合作等）
6. openings: 游戏开场白（1-2个，每个约700字，以第二人称"你"叙述，描写玩家穿越后醒来的第一个场景，包含环境描写、感官细节、悬念引入，让玩家有代入感。不要替玩家做决定或说话。可为空数组表示由 AI 自动生成）

严格按以下 JSON 格式输出，禁止输出任何额外文字或 Markdown 代码块标记：
{
  "title": "标题",
  "synopsis": "剧情梗概",
  "worldBackground": "世界背景",
  "characters": [{"name":"姓名","identity":"身份描述","avatar":""}],
  "relationships": "关系网描述",
  "openings": ["开场白文本1","开场白文本2"]
}`;
    const content = await qtCallAI([{ role: 'user', content: aiPrompt }], { temperature: 0.9 });
    const parsed = qtParseJSON(content, { title: '', synopsis: '', worldBackground: '', characters: [], relationships: '', openings: [] });
    // 确保 openings 是数组且每条非空
    if (!Array.isArray(parsed.openings)) parsed.openings = [];
    parsed.openings = parsed.openings.map(s => String(s || '').trim()).filter(Boolean);
    return parsed;
  }

  async function qtViewWorldview(id) {
    const wv = await db.qt_worldviews.get(id);
    if (!wv) return;
    const overlay = document.getElementById('qt-overlay');
    let charsHtml = '';
    if (Array.isArray(wv.characters) && wv.characters.length > 0) {
      charsHtml = wv.characters.map(c => `<div style="margin-bottom:8px;"><b style="color:${QT_COLORS.gold};">${qtEscape(c.name || '')}</b> - <span style="color:${QT_COLORS.textSub};">${qtEscape(c.identity || '')}</span></div>`).join('');
    } else if (typeof wv.characters === 'string' && wv.characters.trim()) {
      charsHtml = '<div style="font-size:12px; color:' + QT_COLORS.textMain + '; line-height:1.7; white-space:pre-wrap;">' + qtEscape(wv.characters) + '</div>';
    }
    let html = '<div class="qt-overlay-card">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">' + qtEscape(wv.title) + '</div>';
    html += `<div class="qt-card" style="margin:0 0 12px;"><div class="qt-section-title">剧情梗概</div><div style="font-size:12px; color:${QT_COLORS.textMain}; line-height:1.7;">${qtEscape(wv.synopsis || '无')}</div></div>`;
    html += `<div class="qt-card" style="margin:0 0 12px;"><div class="qt-section-title">世界背景</div><div style="font-size:12px; color:${QT_COLORS.textMain}; line-height:1.7; white-space:pre-wrap;">${qtEscape(wv.worldBackground || '无')}</div></div>`;
    if (charsHtml) html += `<div class="qt-card" style="margin:0 0 12px;"><div class="qt-section-title">${QT_ICONS.network}主要人物</div>${charsHtml}</div>`;
    if (wv.relationships) html += `<div class="qt-card" style="margin:0;"><div class="qt-section-title">${QT_ICONS.network}关系网</div><div style="font-size:12px; color:${QT_COLORS.textMain}; line-height:1.7; white-space:pre-wrap;">${qtEscape(wv.relationships)}</div></div>`;
    html += `<div style="margin-top:16px;"><button class="qt-btn qt-btn-primary" id="qt-view-play" style="width:100%;">${QT_ICONS.play}进入游戏</button></div>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('qt-view-play').onclick = () => {
      overlay.classList.remove('active');
      qtStartGame(id);
    };
  }

  async function qtExportWorldview(id) {
    const wv = await db.qt_worldviews.get(id);
    if (!wv) return;
    const json = JSON.stringify(wv, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'worldview_' + (wv.title || 'untitled') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    qtToast('已导出');
  }

  function qtImportWorldview() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          delete data.id;
          data.source = 'import';
          data.createdAt = Date.now();
          await db.qt_worldviews.add(data);
          qtToast('世界观已导入');
          qtRenderTasks();
        } catch (err) {
          qtToast('导入失败：' + (err.message || '格式错误'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async function qtDeleteWorldview(id) {
    if (!confirm('确定删除此世界观？')) return;
    await db.qt_worldviews.delete(id);
    qtToast('已删除');
    qtRenderTasks();
  }

  // ============================================================
  // 8. 开始游戏 + 当前任务列表（最多5个）
  // ============================================================
  async function qtStartGame(worldviewId) {
    // 检查进行中剧本数量
    const activeGames = await db.qt_games.where('status').equals('active').toArray();
    if (activeGames.length >= 5) {
      qtToast('最多同时进行 5 个剧本，请先完结或关闭一个');
      return;
    }
    const wv = await db.qt_worldviews.get(worldviewId);
    if (!wv) { qtToast('世界观不存在'); return; }
    const identity = await db.qt_identity.toCollection().first();
    if (!identity) { qtToast('请先设定身份'); return; }

    // 弹出挂载对话框：选择美化套件 + 挂载世界书
    const overlay = document.getElementById('qt-overlay');
    const beautifies = await db.qt_beautify.toArray();
    let wbs = [];
    try { wbs = await db.world_book_entries.toArray(); } catch (e) {}

    let html = '<div class="qt-overlay-card" style="max-width:460px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">开始游戏 · 挂载资源</div>';
    html += `<div style="font-size:11px; color:${QT_COLORS.textSub}; margin-bottom:12px;">剧本：<b style="color:${QT_COLORS.silver};">${qtEscape(wv.title || '未命名')}</b></div>`;

    // 美化套件选择
    html += `<div class="qt-section-title">${QT_ICONS.beautify}美化套件</div>`;
    html += '<div id="qt-mount-beautify" style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">';
    html += `<div class="qt-mount-option selected" data-bt-id="" style="cursor:pointer;">
      <span class="qt-mount-radio selected"></span>
      <div><div style="font-size:12px; font-weight:600; color:${QT_COLORS.silver};">不使用美化</div>
      <div style="font-size:10px; color:${QT_COLORS.textSub};">纯文本输出</div></div>
    </div>`;
    for (const bt of beautifies) {
      const builtinTag = bt.builtin === 'phone_bubble' ? ' · 内置' : '';
      html += `<div class="qt-mount-option" data-bt-id="${bt.id}" style="cursor:pointer;">
        <span class="qt-mount-radio"></span>
        <div><div style="font-size:12px; font-weight:600; color:${QT_COLORS.silver};">${qtEscape(bt.name || '未命名美化')}${builtinTag}</div>
        <div style="font-size:10px; color:${QT_COLORS.textSub};">正则 ${Array.isArray(bt.regexRules) ? bt.regexRules.length : 0} 条${bt.themeColor ? ' · 主题 ' + qtEscape(bt.themeColor) : ''}</div></div>
      </div>`;
    }
    html += '</div>';

    // 世界书挂载（手风琴式多选）
    html += `<div class="qt-section-title">${QT_ICONS.book}挂载世界书（可选）</div>`;
    html += '<div id="qt-mount-wb-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;"></div>';

    html += `<button class="qt-btn qt-btn-primary" id="qt-mount-confirm" style="width:100%;">${QT_ICONS.play}确认挂载并开始</button>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    // 美化套件单选
    let selectedBtId = null;
    overlay.querySelectorAll('#qt-mount-beautify .qt-mount-option').forEach(opt => {
      opt.onclick = () => {
        selectedBtId = opt.getAttribute('data-bt-id') || null;
        if (selectedBtId === '') selectedBtId = null;
        overlay.querySelectorAll('#qt-mount-beautify .qt-mount-option').forEach(o => {
          o.classList.remove('selected');
          o.querySelector('.qt-mount-radio').classList.remove('selected');
        });
        opt.classList.add('selected');
        opt.querySelector('.qt-mount-radio').classList.add('selected');
      };
    });

    // 世界书挂载列表：四层手风琴（容器 → 分组 → 条目 → 内容），按 group 分组
    const mountedWbIds = new Set();
    const wbListEl = document.getElementById('qt-mount-wb-list');
    if (wbs.length === 0) {
      wbListEl.innerHTML = '<div style="font-size:11px; color:' + QT_COLORS.textDim + '; text-align:center; padding:12px;">暂无世界书条目</div>';
    } else {
      // 按 group 分组（无 group 归到"未分组"）
      const groupMap = new Map();
      wbs.forEach(wb => {
        const g = wb.group || '未分组';
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g).push(wb);
      });
      groupMap.forEach((entries, groupName) => {
        const groupAcc = document.createElement('div');
        groupAcc.className = 'qt-accordion';
        groupAcc.innerHTML = '<div class="qt-accordion-header"><span>' + QT_ICONS.book + qtEscape(groupName) + ' (' + entries.length + ')</span><span class="qt-accordion-arrow">' + QT_ICONS.arrow + '</span></div>' +
          '<div class="qt-accordion-body" style="display:flex; flex-direction:column; gap:6px;"></div>';
        const groupBody = groupAcc.querySelector('.qt-accordion-body');
        groupAcc.querySelector('.qt-accordion-header').onclick = () => groupAcc.classList.toggle('open');
        entries.forEach(wb => {
          const wid = wb.id;
          const item = document.createElement('div');
          item.className = 'qt-wb-item';
          item.innerHTML =
            '<div class="qt-wb-item-header">' +
              '<label class="qt-wb-check" data-wb-id="' + wid + '">' +
                '<input type="checkbox" data-wb-id="' + wid + '">' +
                '<span class="qt-wb-checkmark"></span>' +
              '</label>' +
              '<span class="qt-wb-item-title">' + qtEscape(wb.title || '未命名') + '</span>' +
              '<span class="qt-wb-item-arrow">' + QT_ICONS.arrow + '</span>' +
            '</div>' +
            '<div class="qt-wb-item-body"><div class="qt-wb-item-content">' + qtEscape(wb.content || '（无内容）') + '</div></div>';
          groupBody.appendChild(item);
          const cb = item.querySelector('input[type="checkbox"]');
          cb.onchange = (e) => {
            e.stopPropagation();
            if (cb.checked) { mountedWbIds.add(wid); item.classList.add('selected'); }
            else { mountedWbIds.delete(wid); item.classList.remove('selected'); }
          };
          item.querySelector('.qt-wb-check').onclick = (e) => e.stopPropagation();
          const header = item.querySelector('.qt-wb-item-header');
          header.onclick = (e) => {
            if (e.target.closest('.qt-wb-check')) return;
            item.classList.toggle('open');
          };
        });
        wbListEl.appendChild(groupAcc);
      });
    }

    // 确认挂载并开始
    document.getElementById('qt-mount-confirm').onclick = async () => {
      const finalBtId = selectedBtId ? parseInt(selectedBtId) : null;
      const finalWbIds = Array.from(mountedWbIds);
      overlay.classList.remove('active');
      const gameId = await db.qt_games.add({
        worldviewId,
        identityId: identity.id,
        beautifyId: finalBtId,
        mountedWbIds: finalWbIds,
        status: 'active',
        currentRound: 0,
        title: wv.title || '未命名剧本',
        createdAt: Date.now()
      });
      qtCurrentGameId = gameId;
      const mountInfo = [];
      if (finalBtId) mountInfo.push('美化');
      if (finalWbIds.length > 0) mountInfo.push(finalWbIds.length + ' 条世界书');
      qtToast('剧本已启动' + (mountInfo.length ? '（已挂载：' + mountInfo.join('、') + '）' : ''));
      qtSetView('game');
    };
  }

  async function qtRenderCurrentGames() {
    const body = document.getElementById('qt-body');
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = '当前任务';

    const games = await db.qt_games.where('status').equals('active').toArray();
    let html = '<div class="qt-panel">';
    html += `<div style="margin-bottom:16px;"><button class="qt-btn qt-btn-icon" onclick="window.qtSetViewPublic('home')">${QT_ICONS.back}</button></div>`;
    html += `<div class="qt-section-title">${QT_ICONS.current}进行中剧本 (${games.length}/5)</div>`;
    if (games.length === 0) {
      html += `<div class="qt-card" style="text-align:center; padding:30px; color:${QT_COLORS.textSub}; font-size:13px;">暂无进行中的剧本<br>前往领任务开始穿越</div>`;
    } else {
      for (const g of games) {
        let wv = null;
        try { wv = await db.qt_worldviews.get(g.worldviewId); } catch (e) {}
        html += `<div class="qt-card qt-card-hover" data-game-id="${g.id}" style="cursor:pointer;">
          <div class="qt-wv-title">${qtEscape(g.title)}</div>
          <div style="font-size:11px; color:${QT_COLORS.textSub}; margin-top:4px;">第 ${g.currentRound || 0} 轮 ${wv ? '· ' + qtEscape(wv.title) : ''}</div>
          <div class="qt-wv-actions">
            <button class="qt-btn qt-btn-primary" data-action="continue" data-gid="${g.id}">${QT_ICONS.play}继续游玩</button>
            <button class="qt-btn qt-btn-danger" data-action="abandon" data-gid="${g.id}">放弃</button>
          </div>
        </div>`;
      }
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('[data-game-id]').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('button')) return;
        qtCurrentGameId = parseInt(card.getAttribute('data-game-id'));
        qtSetView('game');
      };
    });
    body.querySelectorAll('[data-action="continue"]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        qtCurrentGameId = parseInt(btn.getAttribute('data-gid'));
        qtSetView('game');
      };
    });
    body.querySelectorAll('[data-action="abandon"]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const gid = parseInt(btn.getAttribute('data-gid'));
        if (!confirm('确定放弃此剧本？所有进度将被删除。')) return;
        await db.qt_games.delete(gid);
        await db.qt_messages.where('gameId').equals(gid).delete();
        await db.qt_summaries.where('gameId').equals(gid).delete();
        await db.qt_variables.where('gameId').equals(gid).delete();
        qtToast('已放弃');
        qtRenderCurrentGames();
      };
    });
  }

  // ============================================================
  // 9. 剧本游玩页
  // ============================================================
  let qtGameSending = false;

  async function qtRenderGame() {
    const body = document.getElementById('qt-body');
    if (qtCurrentGameId == null) { qtSetView('home'); return; }
    const game = await db.qt_games.get(qtCurrentGameId);
    if (!game) { qtSetView('home'); return; }
    const wv = await db.qt_worldviews.get(game.worldviewId);
    const identity = await db.qt_identity.get(game.identityId);
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = game.title || '剧本';

    // 加载美化
    let beautify = null;
    if (game.beautifyId) {
      try { beautify = await db.qt_beautify.get(game.beautifyId); } catch (e) {}
    }
    // 内置美化版本过期则自动升级，确保游玩时用的是最新规则/CSS
    if (beautify && beautify.builtin === 'phone_bubble' && (!beautify.version || beautify.version < 2)) {
      beautify = await qtUpgradeBuiltinBeautify(beautify);
    }
    qtCurrentBeautify = beautify;
    // 注入美化 CSS
    let beautifyStyle = document.getElementById('qt-game-beautify-css');
    if (!beautifyStyle) {
      beautifyStyle = document.createElement('style');
      beautifyStyle.id = 'qt-game-beautify-css';
      document.head.appendChild(beautifyStyle);
    }
    beautifyStyle.textContent = beautify && beautify.css ? beautify.css : '';
    // 应用美化背景到游戏容器
    const qtApp = document.getElementById('qt-body');
    if (qtApp) {
      if (beautify && beautify.background) {
        qtApp.style.backgroundImage = 'url("' + beautify.background.replace(/"/g, '\\"') + '")';
        qtApp.style.backgroundSize = 'cover';
        qtApp.style.backgroundPosition = 'center';
        qtApp.style.backgroundRepeat = 'no-repeat';
      } else {
        qtApp.style.backgroundImage = '';
        qtApp.style.backgroundSize = '';
        qtApp.style.backgroundPosition = '';
        qtApp.style.backgroundRepeat = '';
      }
    }

    body.innerHTML = `
      <div id="qt-game">
        <div class="qt-game-header">
          <button class="qt-btn qt-btn-icon" id="qt-game-back">${QT_ICONS.back}</button>
          <div class="qt-game-title">${qtEscape(game.title || '')} · 第 ${(game.currentRound || 0) + 1} 轮</div>
          <button class="qt-btn qt-btn-icon" id="qt-game-tools">${QT_ICONS.more}</button>
        </div>
        <div class="qt-game-body" id="qt-game-body"></div>
        <div id="qt-danmaku-layer"></div>
        <div id="qt-sys-ball"></div>
        <div class="qt-game-input-bar">
          <textarea class="qt-game-input" id="qt-game-input" placeholder="输入你的行动…" rows="1"></textarea>
          <button class="qt-send-btn" id="qt-game-send">${QT_ICONS.send}</button>
        </div>
      </div>
    `;

    // 渲染消息
    await qtRenderGameMessages();

    // 返回
    document.getElementById('qt-game-back').onclick = () => {
      qtStopDanmaku();
      // 清除美化背景，避免污染其他视图
      const qtApp = document.getElementById('qt-body');
      if (qtApp) { qtApp.style.backgroundImage = ''; qtApp.style.backgroundSize = ''; qtApp.style.backgroundPosition = ''; qtApp.style.backgroundRepeat = ''; }
      qtSetView('current');
    };

    // 工具栏
    document.getElementById('qt-game-tools').onclick = () => qtOpenToolbar();

    // 输入框自适应高度
    const input = document.getElementById('qt-game-input');
    input.oninput = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    };
    // Enter 换行，Ctrl+Enter 发送
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); qtSendGameMessage(); }
    };

    // 发送
    document.getElementById('qt-game-send').onclick = () => qtSendGameMessage();

    // 直播系统
    if (qtGameLiveMode !== 'off') qtStartDanmaku();

    // 系统球球
    qtInitSystemBall();

    // 如果是第一轮，自动生成开场
    if ((game.currentRound || 0) === 0) {
      const msgs = await db.qt_messages.where('gameId').equals(game.id).toArray();
      if (msgs.length === 0) {
        await qtGenerateOpening(game, wv, identity);
      }
    }
  }

  async function qtRenderGameMessages() {
    const container = document.getElementById('qt-game-body');
    if (!container) return;
    const msgs = await db.qt_messages.where('gameId').equals(qtCurrentGameId).toArray();
    if (msgs.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:${QT_COLORS.textSub}; padding:40px; font-size:12px;">剧本即将开始…</div>`;
      return;
    }
    let html = '';
    for (const m of msgs) {
      if (m.role === 'user') {
        html += `<div class="qt-msg qt-msg-user" data-msg-id="${m.id}">${qtEscape(m.content)}</div>`;
      } else {
        const content = m.content || '';
        const renderedContent = qtRenderAiContent(content, qtCurrentBeautify);
        let actionsHtml = '';
        if (m.actions && Array.isArray(m.actions) && m.actions.length > 0) {
          actionsHtml = '<div class="qt-msg-actions">';
          m.actions.forEach((a, i) => {
            actionsHtml += `<div class="qt-action-chip" data-action-text="${qtEscape(a)}">${i + 1}. ${qtEscape(a)}</div>`;
          });
          actionsHtml += '</div>';
        }
        html += `<div class="qt-msg qt-msg-ai" data-msg-id="${m.id}">${renderedContent}${actionsHtml}</div>`;
      }
    }
    container.innerHTML = html;
    // 滚动到底
    container.scrollTop = container.scrollHeight;
    // 绑定推荐行动
    container.querySelectorAll('[data-action-text]').forEach(chip => {
      chip.onclick = () => {
        const text = chip.getAttribute('data-action-text');
        const input = document.getElementById('qt-game-input');
        if (input) { input.value = text; input.focus(); input.oninput(); }
      };
    });
    // 绑定长按唤出消息工具栏（编辑/重roll）
    container.querySelectorAll('[data-msg-id]').forEach(el => {
      qtBindLongPress(el, parseInt(el.getAttribute('data-msg-id')));
    });
  }

  // 长按检测：超过 480ms 且移动距离小则触发
  function qtBindLongPress(el, msgId) {
    let timer = null;
    let startX = 0, startY = 0;
    const start = (e) => {
      if (timer) clearTimeout(timer);
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY;
      timer = setTimeout(() => {
        timer = null;
        qtOpenMsgToolbar(msgId);
        if (navigator.vibrate) navigator.vibrate(15);
      }, 480);
    };
    const move = (e) => {
      if (!timer) return;
      const p = e.touches ? e.touches[0] : e;
      if (Math.abs(p.clientX - startX) > 10 || Math.abs(p.clientY - startY) > 10) {
        clearTimeout(timer); timer = null;
      }
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
  }

  // 消息工具栏：编辑 / 重roll
  async function qtOpenMsgToolbar(msgId) {
    const msg = await db.qt_messages.get(msgId);
    if (!msg) return;
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card" style="max-width:340px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">消息操作</div>';
    html += `<div class="qt-card qt-card-hover" id="qt-msg-edit" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.edit}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">编辑</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">修改这条消息的内容</div></div>
    </div>`;
    if (msg.role === 'ai') {
      html += `<div class="qt-card qt-card-hover" id="qt-msg-reroll" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
        <span class="qt-tool-icon">${QT_ICONS.engine}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">重新生成</div>
        <div style="font-size:11px; color:${QT_COLORS.textSub};">基于上一条玩家行动重新生成回复</div></div>
      </div>`;
    }
    html += `<div class="qt-card qt-card-hover" id="qt-msg-delete" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon" style="color:${QT_COLORS.danger};">${QT_ICONS.trash}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">删除</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">删除这条消息</div></div>
    </div>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    document.getElementById('qt-msg-edit').onclick = () => { overlay.classList.remove('active'); qtEditMessage(msgId); };
    const rerollBtn = document.getElementById('qt-msg-reroll');
    if (rerollBtn) rerollBtn.onclick = () => { overlay.classList.remove('active'); qtRerollMessage(msgId); };
    document.getElementById('qt-msg-delete').onclick = async () => {
      if (!confirm('确定删除这条消息？')) return;
      await db.qt_messages.delete(msgId);
      overlay.classList.remove('active');
      qtToast('已删除');
      qtRenderGameMessages();
    };
  }

  // 编辑消息
  async function qtEditMessage(msgId) {
    const msg = await db.qt_messages.get(msgId);
    if (!msg) return;
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card" style="max-width:440px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">编辑消息</div>';
    html += `<div class="qt-form-group"><textarea class="qt-form-input" id="qt-msg-edit-area" rows="8" style="min-height:160px;">${qtEscape(msg.content || '')}</textarea></div>`;
    html += `<button class="qt-btn qt-btn-primary" id="qt-msg-edit-save" style="width:100%;">保存</button>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('qt-msg-edit-save').onclick = async () => {
      const val = document.getElementById('qt-msg-edit-area').value;
      await db.qt_messages.update(msgId, { content: val });
      overlay.classList.remove('active');
      qtToast('已保存');
      await qtRenderGameMessages();
    };
  }

  // 重新生成 AI 消息：找到上一条 user 消息，删除当前 AI 消息，用该 user 行动重新生成
  async function qtRerollMessage(msgId) {
    if (qtGameSending) { qtToast('请等待当前生成完成'); return; }
    const aiMsg = await db.qt_messages.get(msgId);
    if (!aiMsg || aiMsg.role !== 'ai') return;
    // 找到该 AI 消息之前最近的一条 user 消息
    const allMsgs = await db.qt_messages.where('gameId').equals(qtCurrentGameId).toArray();
    const idx = allMsgs.findIndex(m => m.id === msgId);
    if (idx === -1) { qtToast('消息不存在'); return; }
    let prevUser = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (allMsgs[i].role === 'user') { prevUser = allMsgs[i]; break; }
    }
    if (!prevUser) { qtToast('未找到对应玩家行动'); return; }
    qtGameSending = true;
    qtToast('正在重新生成…');
    try {
      const game = await db.qt_games.get(qtCurrentGameId);
      const wv = await db.qt_worldviews.get(game.worldviewId);
      const identity = await db.qt_identity.get(game.identityId);
      // 删除该 AI 消息及其后的所有消息（保持线性历史）
      const toDelete = allMsgs.filter((m, i) => i >= idx);
      for (const m of toDelete) await db.qt_messages.delete(m.id);
      // 显示加载
      const container = document.getElementById('qt-game-body');
      const loadingEl = document.createElement('div');
      loadingEl.className = 'qt-msg qt-msg-ai';
      loadingEl.id = 'qt-loading-msg';
      loadingEl.innerHTML = '<div class="qt-loading-dots"><span></span><span></span><span></span></div> 正在重新生成…';
      container.appendChild(loadingEl);
      container.scrollTop = container.scrollHeight;
      // 重新生成（基于 prevUser 的内容，保留同一 round）
      const reply = await qtGenerateGameReply(game, wv, identity, prevUser.content, aiMsg.round);
      const lm = document.getElementById('qt-loading-msg');
      if (lm) lm.remove();
      await db.qt_messages.add({
        gameId: qtCurrentGameId,
        role: 'ai',
        content: reply.content,
        actions: reply.actions || [],
        round: aiMsg.round,
        createdAt: Date.now()
      });
      await qtRenderGameMessages();
      // 蓝色模式：每轮单独调用 1 次 API 批量生成弹幕；绿色模式弹幕随 AI 输出返回（在 send 中处理）
      if (qtGameLiveMode === 'blue') qtGenerateDanmakuBatch(reply.content, game);
    } catch (e) {
      const lm = document.getElementById('qt-loading-msg');
      if (lm) lm.remove();
      qtToast('重新生成失败：' + (e.message || ''));
    }
    qtGameSending = false;
  }

  // 发送消息 + 获取回复
  async function qtSendGameMessage() {
    if (qtGameSending) return;
    const input = document.getElementById('qt-game-input');
    const text = (input.value || '').trim();
    const isContinue = !text; // 空文本点发送 = 续写上一条 AI 气泡（不新增 user 消息）
    qtGameSending = true;
    const sendBtn = document.getElementById('qt-game-send');
    sendBtn.disabled = true;

    const game = await db.qt_games.get(qtCurrentGameId);
    const newRound = (game.currentRound || 0) + 1;

    // 有文本时保存 user 消息；空文本（续写）则不新增 user 气泡
    if (!isContinue) {
      await db.qt_messages.add({
        gameId: qtCurrentGameId,
        role: 'user',
        content: text,
        actions: null,
        round: newRound,
        createdAt: Date.now()
      });
      await db.qt_games.update(qtCurrentGameId, { currentRound: newRound });
      input.value = '';
      input.style.height = 'auto';
    } else {
      await db.qt_games.update(qtCurrentGameId, { currentRound: newRound });
    }

    // 立即渲染 user 气泡上屏
    await qtRenderGameMessages();

    // 显示加载
    const container = document.getElementById('qt-game-body');
    const loadingEl = document.createElement('div');
    loadingEl.className = 'qt-msg qt-msg-ai';
    loadingEl.id = 'qt-loading-msg';
    loadingEl.innerHTML = '<div class="qt-loading-dots"><span></span><span></span><span></span></div> 正在推进剧情…';
    container.appendChild(loadingEl);
    container.scrollTop = container.scrollHeight;

    try {
      const wv = await db.qt_worldviews.get(game.worldviewId);
      const identity = await db.qt_identity.get(game.identityId);
      const reply = await qtGenerateGameReply(game, wv, identity, isContinue ? '（玩家选择静观其变，请自然推进剧情发展）' : text, newRound);

      // 移除加载
      const lm = document.getElementById('qt-loading-msg');
      if (lm) lm.remove();

      // 保存 AI 回复
      await db.qt_messages.add({
        gameId: qtCurrentGameId,
        role: 'ai',
        content: reply.content,
        actions: reply.actions || [],
        round: newRound,
        createdAt: Date.now()
      });

      await qtRenderGameMessages();

      // 直播系统：蓝色模式每轮单独调用 1 次 API 批量生成弹幕；绿色模式弹幕随 AI 输出返回
      if (qtGameLiveMode === 'blue') {
        qtGenerateDanmakuBatch(reply.content, game);
      } else if (qtGameLiveMode === 'green' && reply.danmaku && reply.danmaku.length > 0) {
        // 绿色模式：弹幕随 AI 输出返回，逐条慢慢飘出
        reply.danmaku.forEach((dm, i) => {
          setTimeout(() => qtAppendDanmaku(dm.name, dm.text), i * 1500 + 500);
        });
      }

      // 自动总结检查
      await qtCheckAutoSummary(game, newRound);

      // 更新标题轮数
      const titleEl = document.getElementById('qt-title');
      if (titleEl) titleEl.textContent = (game.title || '剧本') + ' · 第 ' + (newRound + 1) + ' 轮';
      const gameTitleEl = document.querySelector('.qt-game-title');
      if (gameTitleEl) gameTitleEl.textContent = (game.title || '') + ' · 第 ' + (newRound + 1) + ' 轮';

    } catch (e) {
      const lm = document.getElementById('qt-loading-msg');
      if (lm) lm.remove();
      qtToast('生成失败：' + (e.message || '未知错误'));
    }
    qtGameSending = false;
    sendBtn.disabled = false;
  }

  // 生成开场白
  async function qtGenerateOpening(game, wv, identity) {
    const container = document.getElementById('qt-game-body');
    const loadingEl = document.createElement('div');
    loadingEl.className = 'qt-msg qt-msg-ai';
    loadingEl.innerHTML = '<div class="qt-loading-dots"><span></span><span></span><span></span></div> 世界正在加载…';
    container.appendChild(loadingEl);

    // 加载挂载的美化套件提示（开场也要遵守美化格式）
    let beautifyHint = '';
    if (game.beautifyId) {
      try {
        const bt = await db.qt_beautify.get(game.beautifyId);
        beautifyHint = qtBuildBeautifyPromptHint(bt);
      } catch (e) {}
    }

    // 优先使用世界观预设的开场白（不再调用 AI）
    if (wv && Array.isArray(wv.openings) && wv.openings.length > 0) {
      const idx = (game.openingIndex || 0) % wv.openings.length;
      const opening = wv.openings[idx];
      loadingEl.remove();
      // 预设开场白按普通文本处理，解析 actions（若含 [ACTIONS]）
      const parsed = qtParseGameReply(opening);
      await db.qt_messages.add({
        gameId: game.id,
        role: 'ai',
        content: parsed.content,
        actions: parsed.actions || [],
        round: 0,
        createdAt: Date.now()
      });
      await qtRenderGameMessages();
      // 渲染开场白切换提示（若有多个开场白）
      if (wv.openings.length > 1) {
        qtRenderOpeningSwitcher(game, wv);
      }
      return;
    }

    let content = '';
    let lastErr = null;
    // 最多重试 2 次（共 3 次请求），兼容 AI 偶发返回空内容
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const prompt = qtBuildOpeningPrompt(wv, identity, beautifyHint);
        const raw = await qtCallAI([{ role: 'user', content: prompt }], { temperature: attempt === 0 ? 0.9 : 0.7, max_tokens: 4096 });
        if (raw && raw.trim().length > 50) {
          content = raw;
          break;
        }
        lastErr = new Error('AI 返回内容过短，可能被截断');
      } catch (e) {
        lastErr = e;
      }
    }

    loadingEl.remove();

    if (!content) {
      // 兜底开场：保证游戏能继续
      const fallbackContent = qtBuildFallbackOpening(wv, identity, beautifyHint);
      const parsed = qtParseGameReply(fallbackContent);
      await db.qt_messages.add({
        gameId: game.id,
        role: 'ai',
        content: parsed.content,
        actions: parsed.actions || [],
        round: 0,
        createdAt: Date.now()
      });
      await qtRenderGameMessages();
      qtToast('开场生成受阻，已使用兜底开场');
      return;
    }

    try {
      const parsed = qtParseGameReply(content);
      await db.qt_messages.add({
        gameId: game.id,
        role: 'ai',
        content: parsed.content,
        actions: parsed.actions || [],
        round: 0,
        createdAt: Date.now()
      });
      await qtRenderGameMessages();
    } catch (e) {
      qtToast('开场渲染失败：' + (e.message || ''));
    }
  }

  // 兜底开场（AI 不可用时保证游戏可玩）
  function qtBuildFallbackOpening(wv, identity, beautifyHint) {
    const npcName = (Array.isArray(wv.characters) && wv.characters[0]) ? (wv.characters[0].name || '神秘人') : '神秘人';
    let body = `你缓缓睁开眼，陌生的天花板映入眼帘。这里是${wv.title || '某个世界'}。\n\n`;
    body += `${wv.worldBackground ? wv.worldBackground + '\n\n' : ''}`;
    body += `你现在是${identity.name || '某人'}${identity.age ? '，' + identity.age + '岁' : ''}。${identity.background ? identity.background : ''}\n\n`;
    body += `门被轻轻推开，${npcName}走了进来，看了你一眼。\n\n`;
    body += `"你醒了。"${npcName}的语气听不出太多情绪，"既然醒了，就别赖着了。"\n\n`;
    body += `你环顾四周，试图弄清楚自己的处境。这里的一切既陌生又真实，你知道，属于你的故事才刚刚开始……\n`;
    if (beautifyHint && (beautifyHint.indexOf('phone_bubble') >= 0 || beautifyHint.indexOf('[STATUS]') >= 0)) {
      body += `\n[STATUS]${npcName}|好感度:30|兴奋值:20|心声:这个人终于醒了，不知道会带来什么变数。[/STATUS]\n`;
    }
    body += `\n[ACTIONS]\n1. 询问${npcName}这里是什么地方\n2. 沉默观察四周环境\n3. 试图回忆自己为什么会在这里`;
    return body;
  }

  // 渲染开场白切换器（左右切换预设开场白）
  function qtRenderOpeningSwitcher(game, wv) {
    const container = document.getElementById('qt-game-body');
    if (!container) return;
    const existing = document.getElementById('qt-opening-switcher');
    if (existing) existing.remove();
    const idx = (game.openingIndex || 0) % wv.openings.length;
    const switcher = document.createElement('div');
    switcher.id = 'qt-opening-switcher';
    switcher.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:12px; padding:10px; margin:8px 0; background:rgba(255,255,255,0.6); border:1px solid ' + QT_COLORS.border + '; border-radius:10px; font-size:11px; color:' + QT_COLORS.textSub + ';';
    switcher.innerHTML =
      '<button class="qt-btn qt-btn-icon" id="qt-opening-prev">' + (QT_ICONS.back || '‹') + '</button>' +
      '<span>开场白 ' + (idx + 1) + ' / ' + wv.openings.length + '</span>' +
      '<button class="qt-btn qt-btn-icon" id="qt-opening-next">' + (QT_ICONS.back || '›') + '</button>';
    container.insertBefore(switcher, container.firstChild);
    document.getElementById('qt-opening-prev').onclick = async () => {
      const newIdx = (idx - 1 + wv.openings.length) % wv.openings.length;
      await db.qt_games.update(game.id, { openingIndex: newIdx });
      // 删除当前 round 0 的 AI 消息，重新渲染
      const msgs = await db.qt_messages.where('gameId').equals(game.id).toArray();
      for (const m of msgs) { if (m.role === 'ai' && (m.round || 0) === 0) await db.qt_messages.delete(m.id); }
      const updatedGame = await db.qt_games.get(game.id);
      qtGenerateOpening(updatedGame, wv, { name: '', age: '', appearance: '', background: '' });
    };
    document.getElementById('qt-opening-next').onclick = async () => {
      const newIdx = (idx + 1) % wv.openings.length;
      await db.qt_games.update(game.id, { openingIndex: newIdx });
      const msgs = await db.qt_messages.where('gameId').equals(game.id).toArray();
      for (const m of msgs) { if (m.role === 'ai' && (m.round || 0) === 0) await db.qt_messages.delete(m.id); }
      const updatedGame = await db.qt_games.get(game.id);
      qtGenerateOpening(updatedGame, wv, { name: '', age: '', appearance: '', background: '' });
    };
  }

  // 构建开场 prompt
  function qtBuildOpeningPrompt(wv, identity, beautifyHint) {
    const charsDesc = Array.isArray(wv.characters)
      ? wv.characters.map(c => '- ' + (c.name || '') + '：' + (c.identity || '')).join('\n')
      : (typeof wv.characters === 'string' ? wv.characters : '');
    return `你是一个长文文字游戏（快穿）的叙事 AI。请根据以下世界观和玩家身份，生成游戏的开场。

【世界观】${wv.title}
【剧情梗概】${wv.synopsis || ''}
【世界背景】${wv.worldBackground || ''}
【主要人物】
${charsDesc}
【人物关系网】${wv.relationships || ''}

【玩家身份】
姓名：${identity.name}
年龄：${identity.age || '未知'}
外貌：${identity.appearance || '未知'}
背景：${identity.background || '未知'}
${beautifyHint}

请生成开场剧情，要求：
1. 【字数硬性要求】正文字数必须在 900-1200 字之间，不得偷工减料，请充分展开场景、动作、对话、心理与环境细节
2. 小说质感，有画面感和氛围
3. 描述玩家"穿越"进入这个世界的初始场景
4. 引入 1-2 个 NPC 与玩家互动，体现其性格
5. 严格遵守世界观设定，不编造与世界背景冲突的内容
6. 【最重要】不能替玩家行动、说话或做决定，只描述环境、NPC 反应和可选的情境
7. NPC 的言行必须符合其人设，不能所有 NPC 都温柔，要各有口吻
8. 不要让单个 NPC 一直占上风，也不要所有 NPC 一次性全部登场

在正文（含状态栏标记）全部结束后，最后另起一行输出 3 个推荐行动选项，格式如下（必须严格遵循，不可省略）：
[ACTIONS]
1. 第一个行动选项（简短，10-20字）
2. 第二个行动选项
3. 第三个行动选项

直接输出剧情正文和行动选项，不要加任何解释。[ACTIONS] 标记和 3 个选项是必须输出的，缺一不可。`;
  }

  // 构建游玩 prompt
  async function qtBuildGamePrompt(game, wv, identity, userInput, round) {
    // 加载最近消息（最近 4 轮，每条正文截断到 400 字，避免历史膨胀挤占输出额度）
    const allMsgs = await db.qt_messages.where('gameId').equals(game.id).toArray();
    const recentMsgs = allMsgs.slice(-8);
    const historyText = recentMsgs.map(m => {
      const rawBody = (m.content || '').split('\n[ACTIONS]')[0];
      // 清洗上下文中的标签（破损标签补齐 + 转为可读文本），再截断
      const body = qtCleanTagsForContext(rawBody).slice(0, 400);
      return (m.role === 'user' ? '【玩家】' : '【叙事】') + body;
    }).join('\n\n');

    // 加载相关总结（关键词召回）
    const summaries = await db.qt_summaries.where('gameId').equals(game.id).toArray();
    const userInputLower = userInput.toLowerCase();
    const matched = summaries.filter(s => {
      const kws = Array.isArray(s.keywords) ? s.keywords : [];
      return kws.some(k => k && userInputLower.includes(String(k).toLowerCase()));
    }).slice(-3); // 最多召回3条
    const summaryText = matched.length > 0
      ? matched.map(s => '第' + s.round + '轮总结：' + (s.plotShift || '') + '；' + (s.keyFacts || '')).join('\n')
      : '';

    // 加载变量
    const variables = await db.qt_variables.where('gameId').equals(game.id).toArray();
    const varText = variables.length > 0
      ? variables.map(v => v.key + '=' + v.value).join('，')
      : '';

    // 加载剧情引擎
    const engineText = game.plotEngine || '';

    // 加载系统球球注入的效果（道具/求助，影响本轮，用后清空）
    const sysEffects = Array.isArray(game.sysEffects) ? game.sysEffects : [];
    const sysEffectText = sysEffects.length > 0 ? sysEffects.join('\n') : '';
    if (sysEffects.length > 0) {
      // 本轮已注入，生成后清空（在 qtGenerateGameReply 完成后由调用方清空）
      game._pendingSysClear = true;
    }

    // 加载挂载的世界书条目（开始游戏时挂载）
    const mountedWbText = await qtBuildMountedWorldbook(game);

    // 加载挂载的美化套件提示
    let beautifyHint = '';
    if (game.beautifyId) {
      try {
        const bt = await db.qt_beautify.get(game.beautifyId);
        beautifyHint = qtBuildBeautifyPromptHint(bt);
      } catch (e) {}
    }

    const charsDesc = Array.isArray(wv.characters)
      ? wv.characters.map(c => '- ' + (c.name || '') + '：' + (c.identity || '')).join('\n')
      : (typeof wv.characters === 'string' ? wv.characters : '');

    return `你是一个长文文字游戏（快穿）的叙事 AI。请根据以下信息推进剧情。

【世界观】${wv.title}
【世界背景】${wv.worldBackground || ''}
【主要人物】
${charsDesc}
【人物关系网】${wv.relationships || ''}
${mountedWbText ? '【挂载的世界书】\n' + mountedWbText : ''}

【玩家身份】
姓名：${identity.name}，年龄：${identity.age || '未知'}，外貌：${identity.appearance || '未知'}
背景：${identity.background || '未知'}

【当前轮数】第 ${round} 轮

【历史剧情摘要（最近几轮）】
${historyText || '（刚开始）'}

${summaryText ? '【相关总结（关键词召回）】\n' + summaryText : ''}

${varText ? '【当前变量状态】' + varText : ''}

${engineText ? '【剧情引擎指令】' + engineText : ''}
${sysEffectText ? '【系统干预（本轮必须体现）】\n' + sysEffectText : ''}
${beautifyHint}

【玩家本轮行动】${userInput}

请推进剧情，要求：
1. 【字数硬性要求】正文字数必须在 900-1200 字之间，不得偷工减料、不得提前收尾、不得用省略号或概括代替具体描写。请充分展开场景、动作、对话、心理与环境细节。
2. 小说质感，有画面感、氛围感和情绪张力
3. 严格遵守世界观设定和人物关系，不编造冲突内容
4. NPC 的言行必须严格符合其人设和性格，各有口吻，不能所有 NPC 都温柔或都冷酷
5. 【最重要】绝对不能替玩家（${identity.name}）行动、说话、思考或做决定，只描述环境变化、NPC 反应和剧情推进
6. 不要让单个 NPC 一直占上风，也不要所有 NPC 一次性全部登场摆出来，要有节奏
7. 要有剧情发展，不能原地踏步，每轮都要推进故事
8. 如有多人在场，让对话自然交替，体现不同立场

在正文（含状态栏标记）全部结束后，最后另起一行输出 3 个推荐行动选项，格式如下（必须严格遵循，不可省略）：
[ACTIONS]
1. 第一个行动选项（简短，10-20字）
2. 第二个行动选项
3. 第三个行动选项

直接输出剧情正文和行动选项，不要加任何解释。[ACTIONS] 标记和 3 个选项是必须输出的，缺一不可。${qtGameLiveMode === 'green' ? `

【直播弹幕（必须输出）】
本剧情正在直播间直播，请在 [ACTIONS] 之后另起一行输出弹幕标记，内含 6-8 条观众弹幕：
[DANMAKU]
网名1:评论内容1
网名2:评论内容2
...
[/DANMAKU]

弹幕要求：
1. 网名必须是真实的直播间观众风格（如"吃瓜路人""CP粉头""熬夜选手"等），严禁使用剧情中的角色名字作为网名
2. 评论内容必须围绕本轮剧情的具体人物、事件或氛围，可以站CP、猜测走向、心疼角色、吐槽反派等
3. 每条 8-20 字，不要说"666""这波操作"等空话
4. [DANMAKU] 标记和 6-8 条弹幕是必须输出的，缺一不可` : ''}`;
  }

  // 构建挂载的世界书文本（开始游戏时挂载的条目）
  async function qtBuildMountedWorldbook(game) {
    const ids = Array.isArray(game.mountedWbIds) ? game.mountedWbIds : [];
    if (ids.length === 0) return '';
    const entries = [];
    for (const id of ids) {
      try {
        const wb = await db.world_book_entries.get(id);
        if (wb && wb.content) entries.push('【' + (wb.title || '条目') + '】' + wb.content);
      } catch (e) {}
    }
    return entries.join('\n');
  }

  async function qtGenerateGameReply(game, wv, identity, userInput, round) {
    const prompt = await qtBuildGamePrompt(game, wv, identity, userInput, round);
    const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.88 });
    // 生成后清空系统球球注入的效果（已在本轮体现）
    if (game._pendingSysClear) {
      try { await db.qt_games.update(qtCurrentGameId, { sysEffects: [] }); } catch (e) {}
    }
    return qtParseGameReply(content);
  }

  // 解析游戏回复：分离正文和推荐行动
  function qtParseGameReply(content) {
    let raw = String(content || '');
    let actions = [];
    let danmaku = []; // 绿色模式：随 AI 输出返回的弹幕
    let body = raw;
    // 优先分离 [DANMAKU] 标记（绿色模式弹幕随 AI 输出返回）
    const dmM = raw.match(/\[DANMAKU\]\s*([\s\S]*?)\[\/DANMAKU\]/i);
    if (dmM) {
      raw = raw.replace(dmM[0], '').trim();
      danmaku = dmM[1].trim().split('\n').map(l => {
        const m = l.match(/^(.+?)[:：](.+)$/);
        return m ? { name: m[1].trim().slice(0, 8), text: m[2].trim().slice(0, 30) } : null;
      }).filter(Boolean);
    }
    // 优先匹配 [ACTIONS] 标记
    const actionsM = raw.match(/\[ACTIONS\]\s*([\s\S]*?)$/i);
    if (actionsM) {
      body = raw.slice(0, raw.indexOf(actionsM[0])).trim();
      const lines = actionsM[1].trim().split('\n').map(l => l.replace(/^\d+[\.\)、]\s*/, '').trim()).filter(Boolean);
      // 过滤掉 [STATUS] 等标记行
      actions = lines.filter(l => !/^\[\/?(STATUS|PHONE)/i.test(l)).slice(0, 3);
    } else {
      // 兜底：末尾连续的 "1. xxx\n2. xxx\n3. xxx" 行
      const tailM = raw.match(/((?:^|\n)\s*\d+[\.\)、]\s*.+){2,4}\s*$/);
      if (tailM) {
        const tail = tailM[0];
        body = raw.slice(0, raw.indexOf(tail)).trim();
        actions = tail.trim().split('\n').map(l => l.replace(/^\s*\d+[\.\)、]\s*/, '').trim()).filter(Boolean).slice(0, 3);
      }
    }
    return { content: body, actions, danmaku };
  }

  // 标签清洗与破损标签补齐：在应用正则规则前对 [PHONE]/[STATUS] 标签做规范化
  // 1. 全角冒号/竖线归一化为半角，字段名后多余空格去除
  // 2. 降级格式补全（2字段PHONE补空头像 / 无标签STATUS补标签）
  // 3. 缺失闭合标签的破损标签补齐
  // 4. 孤立的闭合/开标签清除
  function qtNormalizeTags(text) {
    let t = String(text || '');
    const normStatus = (s) => s.replace(/：/g, ':').replace(/｜/g, '|').replace(/(好感度|兴奋值|心声):\s*/gi, '$1:');
    const normPhone = (s) => s.replace(/｜/g, '|');
    // 用占位符保护已处理的标签，避免后续步骤误伤
    const done = [];
    const protect = (tag) => { done.push(tag); return '\u0001T' + (done.length - 1) + '\u0001'; };

    // 1a. 成对 [STATUS]...[/STATUS]：归一化内部
    t = t.replace(/\[STATUS\]([\s\S]*?)\[\/STATUS\]/gi, (m, inner) => {
      return protect('[STATUS]' + normStatus(inner) + '[/STATUS]');
    });
    // 1b. 破损 [STATUS]（无闭合）：补齐 + 归一化
    t = t.replace(/\[STATUS\]([\s\S]*?)(?=\[STATUS\]|\[PHONE\]|\[ACTIONS\]|\u0001T|$)/gi, (m, inner) => {
      return protect('[STATUS]' + normStatus(inner) + '[/STATUS]');
    });
    // 2a. 成对 [PHONE]...[/PHONE]：归一化内部
    t = t.replace(/\[PHONE\]([\s\S]*?)\[\/PHONE\]/gi, (m, inner) => {
      return protect('[PHONE]' + normPhone(inner) + '[/PHONE]');
    });
    // 2b. 破损 [PHONE]（无闭合）：补齐 + 归一化
    t = t.replace(/\[PHONE\]([\s\S]*?)(?=\[STATUS\]|\[PHONE\]|\[ACTIONS\]|\u0001T|$)/gi, (m, inner) => {
      return protect('[PHONE]' + normPhone(inner) + '[/PHONE]');
    });
    // 3. 清除孤立的闭合标签（此时所有合法标签已被占位符保护）
    t = t.replace(/\[\/(STATUS|PHONE)\]/gi, '');
    // 4. 还原占位符
    t = t.replace(/\u0001T(\d+)\u0001/g, (m, idx) => done[parseInt(idx)] || '');
    // 5. 清除空的开标签（紧跟 [ACTIONS] 或文本末尾）
    t = t.replace(/\[(STATUS|PHONE)\](?=\s*\[ACTIONS\]|\s*$)/gi, '');
    return t;
  }

  // 上下文标签清洗：将 [PHONE]/[STATUS] 标签转为可读文本，破损标签补齐后转换或清除
  // 用于构建 AI 历史 prompt，避免原始标签干扰 AI 理解
  function qtCleanTagsForContext(text) {
    let t = String(text || '');
    // 先做标签归一化（补齐破损、全角转半角）
    t = qtNormalizeTags(t);
    // [PHONE]sender|avatar|message[/PHONE] → （手机）sender：message
    t = t.replace(/\[PHONE\]([^|]*)\|([^|]*)\|([\s\S]*?)\[\/PHONE\]/gi, (m, sender, avatar, msg) => {
      return '（手机消息）' + (sender || '').trim() + '：' + (msg || '').trim();
    });
    // [STATUS]NPC|好感度:80|兴奋值:50|心声:xxx[/STATUS] → （状态）NPC 好感度:80 兴奋值:50 心声:xxx
    t = t.replace(/\[STATUS\]([^|]*)\|好感度:(\d+)\|兴奋值:(\d+)\|心声:([\s\S]*?)\[\/STATUS\]/gi, (m, npc, fav, exc, thought) => {
      return '（' + (npc || '').trim() + ' 状态）好感度:' + fav + ' 兴奋值:' + exc + ' 心声：' + (thought || '').trim();
    });
    // 清除残留的未匹配标签碎片
    t = t.replace(/\[\/?(STATUS|PHONE)\]/gi, '');
    return t;
  }

  // 渲染 AI 回复内容：先清洗标签 → 提取标签为占位符 → escape 纯文本 → 保留换行 → 应用正则规则 → 还原占位符
  // 关键：正则在原始文本上匹配（标签未转义），HTML 替换体用占位符保护，最后注入到气泡内
  function qtRenderAiContent(content, beautify) {
    let text = String(content || '');
    // 先做标签清洗与破损补齐（仅对内置 phone_bubble 美化生效）
    if (beautify && beautify.builtin === 'phone_bubble') {
      text = qtNormalizeTags(text);
    }
    const htmlChunks = [];
    // 占位符：\u0000索引\u0000，escape 后仍保留（控制字符不在转义表内）
    const stash = (html) => { htmlChunks.push(html); return '\u0000' + (htmlChunks.length - 1) + '\u0000'; };

    if (beautify && Array.isArray(beautify.regexRules)) {
      for (const rule of beautify.regexRules) {
        if (!rule.pattern) continue;
        try {
          const re = new RegExp(rule.pattern, 'g');
          // 注意：必须用普通 function 而非箭头函数，才能拿到 arguments（捕获组）
          text = text.replace(re, function() {
            // 将捕获组按 $1/$2/... 还原进 replacement
            // 捕获组内容来自 AI 输出，必须先 HTML 转义，否则内容里的 " < > & 会撑破 replacement 的 HTML 结构（掉格式/掉出气泡）
            let rep = rule.replacement || '';
            // arguments[0] 是完整匹配，arguments[1..] 是捕获组
            for (let i = arguments.length - 1; i >= 1; i--) {
              rep = rep.split('$' + i).join(qtEscape(arguments[i] || ''));
            }
            // 对 replacement 中的 HTML 直接 stash（不再 escape），保护它不被后续 escape 破坏
            return stash(rep);
          });
        } catch (e) {}
      }
    }
    // escape 剩余纯文本
    text = qtEscape(text);
    // 保留换行
    text = text.replace(/\n/g, '<br>');
    // 还原占位符为 HTML（渲染在气泡内部）
    text = text.replace(/\u0000(\d+)\u0000/g, (m, idx) => htmlChunks[parseInt(idx)] || '');
    return text;
  }

  // 构建内置美化"拟物手机气泡"的 prompt 提示（注入到游戏 prompt）
  function qtBuildBeautifyPromptHint(beautify) {
    if (!beautify || !beautify.builtin) return '';
    if (beautify.builtin === 'phone_bubble') {
      return `\n【美化输出格式要求（每轮必须严格遵守，缺一不可）】
本轮启用了"拟物手机气泡"美化，你必须在输出中包含以下两类标记，否则前端渲染会异常：

1. 手机消息标记（正文中有 NPC 发手机消息时使用，可多次出现）：
[PHONE]发信人|头像URL|消息内容[/PHONE]
示例：[PHONE]沈怀瑾||小鱼，周日晚上的慈善晚宴不要忘了。[/PHONE]
（头像URL留空即两个竖线连写；消息内容为该 NPC 发送的文字）

2. 状态栏标记（正文结束后、[ACTIONS]之前，为本轮出场的每个 NPC 各输出一个）：
[STATUS]NPC名|好感度:0-100的整数|兴奋值:0-100的整数|心声:该NPC此刻内心想法[/STATUS]
示例：[STATUS]沈言琛|好感度:58|兴奋值:78|心声:她居然敢当着我面说这句话。[/STATUS]

【重要提醒】
- [PHONE] 和 [STATUS] 标记是本美化的核心，每轮至少输出一个 [STATUS]（只要有 NPC 出场）
- 标记内的竖线 | 必须用半角，字段名（好感度/兴奋值/心声）后紧跟半角冒号:
- 这些标记会被前端解析为拟物化手机气泡和状态栏，不要把它们当作文案的一部分
- 标记必须成对出现：有开标签就必须有对应的 [/PHONE] 或 [/STATUS] 闭合标签`;
    }
    return beautify.promptHint || '';
  }

  // 创建内置美化套件（完整 CSS + 正则规则 + 状态栏）
  // silent=true 时仅播种，不弹出编辑器
  // 构建内置美化数据对象（不写库）；qtCreateBuiltinBeautify 写库，qtUpgradeBuiltinBeautify 升级旧库条目复用它
  function qtBuildBuiltinBeautifyData() {
    const builtin = {
      name: '拟物手机气泡',
      themeColor: '#3b82f6',
      background: '',
      builtin: 'phone_bubble',
      css: [
        '/* === 拟物手机气泡 === */',
        '.qt-phone-bubble {',
        '  display: flex; align-items: flex-start; gap: 8px;',
        '  margin: 10px 0; padding: 10px 12px;',
        '  background: linear-gradient(180deg, #ffffff, #eef1f6);',
        '  border: 1px solid #cbd5e1; border-radius: 14px;',
        '  box-shadow: 0 2px 8px rgba(100,116,139,0.16), inset 0 1px 0 rgba(255,255,255,0.95);',
        '}',
        '.qt-phone-bubble img, .qt-phone-avatar-placeholder {',
        '  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;',
        '  border: 1px solid #cbd5e1; object-fit: cover;',
        '  box-shadow: 0 1px 3px rgba(100,116,139,0.15);',
        '}',
        '.qt-phone-avatar-placeholder { background: #dfe4ec; box-shadow: inset 0 1px 2px rgba(100,116,139,0.15); }',
        '.qt-phone-content { flex: 1; min-width: 0; }',
        '.qt-phone-sender { font-size: 11px; font-weight: 700; color: #3b82f6; margin-bottom: 3px; }',
        '.qt-phone-msg { font-size: 13px; color: #334155; line-height: 1.6; word-break: break-word; }',
        '',
        '/* === 状态栏（好感度/兴奋值/心声）=== */',
        '.qt-status-bar {',
        '  margin: 12px 0 6px; padding: 12px 14px;',
        '  background: linear-gradient(180deg, #ffffff, #eef1f6);',
        '  border: 1px solid #cbd5e1; border-radius: 12px;',
        '  box-shadow: 0 2px 8px rgba(100,116,139,0.14), inset 0 1px 0 rgba(255,255,255,0.95);',
        '}',
        '.qt-status-npc { font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #cbd5e1; letter-spacing: 1px; }',
        '.qt-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; }',
        '.qt-status-label { width: 48px; flex-shrink: 0; color: #64748b; font-weight: 600; }',
        '.qt-status-meter { flex: 1; height: 8px; background: #dfe4ec; border-radius: 4px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(100,116,139,0.2); }',
        '.qt-status-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 4px; transition: width 0.4s ease; }',
        '.qt-status-fill-excited { background: linear-gradient(90deg, #f59e0b, #fbbf24); }',
        '.qt-status-val { width: 32px; text-align: right; color: #475569; font-weight: 700; flex-shrink: 0; }',
        '.qt-status-thought { align-items: flex-start; }',
        '.qt-status-thought-text { flex: 1; color: #64748b; font-style: italic; line-height: 1.5; }'
      ].join('\n'),
      regexRules: [
        {
          pattern: '\\[PHONE\\]([^|]+)\\|([^|]*)\\|([\\s\\S]*?)\\[\\/PHONE\\]',
          replacement: '<div class="qt-phone-bubble"><img src="$2" onerror="this.outerHTML=\'<div class=qt-phone-avatar-placeholder></div>\'"><div class="qt-phone-content"><div class="qt-phone-sender">$1</div><div class="qt-phone-msg">$3</div></div></div>'
        },
        {
          pattern: '\\[STATUS\\]([^|]+)\\|好感度:(\\d+)\\|兴奋值:(\\d+)\\|心声:([\\s\\S]*?)\\[\\/STATUS\\]',
          replacement: '<div class="qt-status-bar"><div class="qt-status-npc">$1</div><div class="qt-status-row"><span class="qt-status-label">好感度</span><div class="qt-status-meter"><div class="qt-status-fill" style="width:$2%"></div></div><span class="qt-status-val">$2</span></div><div class="qt-status-row"><span class="qt-status-label">兴奋值</span><div class="qt-status-meter"><div class="qt-status-fill qt-status-fill-excited" style="width:$3%"></div></div><span class="qt-status-val">$3</span></div><div class="qt-status-row qt-status-thought"><span class="qt-status-label">心声</span><span class="qt-status-thought-text">$4</span></div></div>'
        }
      ],
      promptHint: '在正文剧情中，每当有 NPC 发送手机消息时，用以下标记输出：\n[PHONE]发信人|头像URL|消息内容[/PHONE]\n在正文结束后、[ACTIONS]之前，为本轮出场的每个 NPC 输出状态栏：\n[STATUS]NPC名|好感度:0-100的整数|兴奋值:0-100的整数|心声:该NPC此刻的内心想法[/STATUS]',
      version: 2, // 内置美化版本：bump 后会自动升级旧 DB 中的过时规则/CSS
      createdAt: Date.now()
    };
    return builtin;
  }

  // 创建内置美化套件（完整 CSS + 正则规则 + 状态栏）
  // silent=true 时仅播种，不弹出编辑器
  async function qtCreateBuiltinBeautify(silent) {
    const builtin = qtBuildBuiltinBeautifyData();
    const id = await db.qt_beautify.add(builtin);
    if (silent) return id;
    qtToast('已创建内置美化：拟物手机气泡');
    qtEditBeautify(id);
    return id;
  }

  // 升级旧 DB 中的内置美化：用最新 css/regexRules/promptHint/version 覆盖，保留 id/name/createdAt
  async function qtUpgradeBuiltinBeautify(existing) {
    if (!existing || !existing.id) return existing;
    const latest = qtBuildBuiltinBeautifyData();
    await db.qt_beautify.update(existing.id, {
      css: latest.css,
      regexRules: latest.regexRules,
      promptHint: latest.promptHint,
      themeColor: latest.themeColor,
      version: latest.version
    });
    return { ...existing, ...latest, id: existing.id, createdAt: existing.createdAt };
  }

  // ============================================================
  // 10. 工具栏：直播系统/总结/变量控制/剧情引擎
  // ============================================================
  function qtOpenToolbar() {
    const overlay = document.getElementById('qt-overlay');
    let html = '<div class="qt-overlay-card" style="max-width:380px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">剧本工具</div>';
    // 显示系统切换（显示/隐藏系统小球）
    const sysVisible = qtSysBallState.visible !== false;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-sys" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.user || '👤'}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">显示系统</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">显示/隐藏系统小球</div></div>
      <div style="margin-left:auto; font-size:11px; color:${sysVisible ? QT_COLORS.success : QT_COLORS.textDim};">${sysVisible ? '已显示' : '已隐藏'}</div>
    </div>`;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-live" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.live}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">直播系统</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">每轮生成路人弹幕</div></div>
      <div style="margin-left:auto; font-size:11px; color:${qtGameLiveMode === 'green' ? QT_COLORS.success : (qtGameLiveMode === 'blue' ? QT_COLORS.accent : QT_COLORS.textDim)};">${qtGameLiveMode === 'green' ? '随动产生' : (qtGameLiveMode === 'blue' ? '每轮单独调用' : '已关闭')}</div>
    </div>`;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-summary" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.summary}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">总结</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">查看/自动总结/关键词召回</div></div>
    </div>`;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-var" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.variable}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">变量控制</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">时间/年龄/状态等记忆变量</div></div>
    </div>`;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-engine" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon">${QT_ICONS.engine}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">剧情引擎</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">设定剧情发展方向</div></div>
    </div>`;
    html += `<div class="qt-card qt-card-hover" id="qt-tool-finish" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <span class="qt-tool-icon" style="color:${QT_COLORS.danger};">${QT_ICONS.finish}</span><div><div style="font-size:13px; font-weight:700; color:${QT_COLORS.silverBright};">完结剧本</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub};">结束本次穿越，归档</div></div>
    </div>`;
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    document.getElementById('qt-tool-sys').onclick = () => {
      qtSysBallState.visible = !sysVisible;
      const ball = document.getElementById('qt-sys-ball');
      if (ball) ball.style.display = qtSysBallState.visible === false ? 'none' : '';
      overlay.classList.remove('active');
      qtToast(qtSysBallState.visible === false ? '系统已隐藏' : '系统已显示');
    };
    document.getElementById('qt-tool-live').onclick = () => { overlay.classList.remove('active'); qtToggleLive(); };
    document.getElementById('qt-tool-summary').onclick = () => { overlay.classList.remove('active'); qtOpenSummary(); };
    document.getElementById('qt-tool-var').onclick = () => { overlay.classList.remove('active'); qtOpenVariables(); };
    document.getElementById('qt-tool-engine').onclick = () => { overlay.classList.remove('active'); qtOpenEngine(); };
    document.getElementById('qt-tool-finish').onclick = async () => {
      overlay.classList.remove('active');
      if (!confirm('确定完结此剧本？完结后将归档，无法继续游玩。')) return;
      await db.qt_games.update(qtCurrentGameId, { status: 'finished' });
      qtStopDanmaku();
      qtToast('剧本已完结，归档成功');
      qtSetView('current');
    };
  }

  // 直播系统
  // 弹幕三态切换：off(红) → green(绿/随AI输出) → blue(蓝/每轮单独调用) → off(红)
  function qtToggleLive() {
    const next = qtGameLiveMode === 'off' ? 'green' : (qtGameLiveMode === 'green' ? 'blue' : 'off');
    qtGameLiveMode = next;
    if (next === 'off') {
      qtStopDanmaku();
      qtToast('弹幕已关闭');
    } else if (next === 'green') {
      qtStartDanmaku();
      qtToast('弹幕：随动产生（随AI输出一次性返回）');
    } else {
      qtStartDanmaku();
      qtToast('弹幕：每轮单独调用');
    }
  }

  function qtStartDanmaku() {
    qtStopDanmaku();
    // 蓝色模式：每 15-25 秒补充几条弹幕保持氛围（1 次 API 返回 3-5 条）
    if (qtGameLiveMode !== 'blue') return;
    const tick = () => {
      qtGenerateDanmakuBatch(null, null, 3 + Math.floor(Math.random() * 3));
      qtDanmakuTimer = setTimeout(tick, 15000 + Math.random() * 10000);
    };
    qtDanmakuTimer = setTimeout(tick, 5000);
  }

  function qtStopDanmaku() {
    if (qtDanmakuTimer) { clearTimeout(qtDanmakuTimer); qtDanmakuTimer = null; }
  }

  // 蓝色模式：1 次 API 调用批量生成多条弹幕，逐条慢慢飘出（减少按次收费开销）
  async function qtGenerateDanmakuBatch(storyContent, game, count) {
    try {
      if (count == null) count = 6 + Math.floor(Math.random() * 3); // 6-8 条
      // 加载当前游戏上下文
      if (!game && qtCurrentGameId != null) game = await db.qt_games.get(qtCurrentGameId);
      let npcNames = [];
      let worldTitle = '';
      if (game) {
        try {
          const wv = await db.qt_worldviews.get(game.worldviewId);
          if (wv) {
            worldTitle = wv.title || '';
            if (Array.isArray(wv.characters)) npcNames = wv.characters.map(c => c.name).filter(Boolean);
          }
        } catch (e) {}
      }
      if (!storyContent && qtCurrentGameId != null) {
        const msgs = await db.qt_messages.where('gameId').equals(qtCurrentGameId).toArray();
        const lastAi = [...msgs].reverse().find(m => m.role === 'ai');
        if (lastAi) storyContent = lastAi.content;
      }
      let ctx = '';
      if (worldTitle) ctx += '当前剧情世界：' + worldTitle + '\n';
      if (npcNames.length > 0) ctx += '剧情中的角色：' + npcNames.join('、') + '\n';
      if (storyContent) ctx += '最近剧情片段：' + qtCleanTagsForContext(storyContent).slice(0, 400);

      const prompt = '你是一个直播间的观众，正在观看上面播放的剧情。请写 ' + count + ' 条弹幕评论。\n' +
        '要求：\n' +
        '1. 必须围绕上面给出的剧情角色、事件或氛围来评论，可以站CP、猜测走向、心疼角色、吐槽反派等\n' +
        '2. 网名必须是真实的直播间观众风格（如"吃瓜路人""CP粉头""熬夜选手"等），严禁使用剧情中的角色名字作为网名\n' +
        '3. 每条评论 8-20 字，不要说"666""这波操作"等空话\n' +
        '4. 严格按以下格式输出，每行一条，不要其他文字：\n网名1:内容1\n网名2:内容2\n...\n\n' +
        (ctx || '（暂无剧情信息）');
      const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 1.1 });
      // 逐行解析，逐条慢慢飘出
      const lines = content.split('\n').filter(l => l.trim());
      let idx = 0;
      lines.forEach(line => {
        const m = line.match(/^(.+?)[:：](.+)$/);
        if (m) {
          let name = m[1].trim().slice(0, 8);
          if (npcNames.some(n => name.includes(n))) name = '吃瓜路人';
          const text = m[2].trim().slice(0, 30);
          setTimeout(() => qtAppendDanmaku(name, text), idx * 1500 + 500);
          idx++;
        }
      });
    } catch (e) { /* 静默 */ }
  }

  function qtAppendDanmaku(name, text) {
    const layer = document.getElementById('qt-danmaku-layer');
    if (!layer) return;
    const dm = document.createElement('div');
    dm.className = 'qt-danmaku';
    dm.innerHTML = '<span class="qt-dm-name">' + qtEscape(name) + '</span>' + qtEscape(text);
    // 随机垂直位置（避开顶部 header 与底部输入栏）
    dm.style.top = (10 + Math.random() * 72) + '%';
    layer.appendChild(dm);
    // 精确平移：从右侧外冒头，平移到左侧外完全飘出
    const containerWidth = layer.clientWidth;
    const dmWidth = dm.offsetWidth || 80;
    const distance = containerWidth + dmWidth;
    const duration = 11000 + Math.random() * 5000; // 11-16 秒，缓缓飘过
    const anim = dm.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(' + (-distance) + 'px)' }
      ],
      { duration: duration, easing: 'linear', fill: 'forwards' }
    );
    anim.onfinish = () => { if (dm.parentNode) dm.remove(); };
  }

  // 总结系统
  let qtAutoSummaryEvery = 0; // 0=关闭，n=每n轮自动总结

  async function qtOpenSummary() {
    const overlay = document.getElementById('qt-overlay');
    const game = await db.qt_games.get(qtCurrentGameId);
    const summaries = await db.qt_summaries.where('gameId').equals(qtCurrentGameId).toArray();
    const totalRounds = game.currentRound || 0;
    const summarizedRounds = summaries.length;

    let html = '<div class="qt-overlay-card" style="max-width:440px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">总结管理</div>';
    html += `<div style="display:flex; gap:12px; margin-bottom:16px; font-size:12px;">
      <div style="flex:1; text-align:center; padding:10px; background:linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid}); border:1px solid ${QT_COLORS.border}; border-radius:10px; box-shadow:0 1px 4px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);">
        <div style="font-size:20px; font-weight:700; color:${QT_COLORS.silverBright};">${totalRounds}</div>
        <div style="color:${QT_COLORS.textSub};">总轮数</div>
      </div>
      <div style="flex:1; text-align:center; padding:10px; background:linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid}); border:1px solid ${QT_COLORS.border}; border-radius:10px; box-shadow:0 1px 4px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);">
        <div style="font-size:20px; font-weight:700; color:${QT_COLORS.success};">${summarizedRounds}</div>
        <div style="color:${QT_COLORS.textSub};">已总结</div>
      </div>
      <div style="flex:1; text-align:center; padding:10px; background:linear-gradient(180deg, ${QT_COLORS.bgSurface}, ${QT_COLORS.bgMid}); border:1px solid ${QT_COLORS.border}; border-radius:10px; box-shadow:0 1px 4px rgba(100,116,139,0.12), inset 0 1px 0 rgba(255,255,255,0.9);">
        <div style="font-size:20px; font-weight:700; color:${QT_COLORS.gold};">${Math.max(0, totalRounds - summarizedRounds)}</div>
        <div style="color:${QT_COLORS.textSub};">待总结</div>
      </div>
    </div>`;

    html += `<div class="qt-form-group">
      <label class="qt-form-label">自动总结（每 N 轮，0=关闭）</label>
      <input type="number" class="qt-form-input" id="qt-auto-summary" value="${qtAutoSummaryEvery}" min="0" max="20">
    </div>`;
    html += `<div class="qt-form-group">
      <label class="qt-form-label">每轮最多召回总结数</label>
      <input type="number" class="qt-form-input" id="qt-max-recall" value="${game.maxRecall || 3}" min="1" max="10">
    </div>`;
    html += `<button class="qt-btn qt-btn-primary" id="qt-summary-gen" style="width:100%; margin-bottom:12px;">手动生成本轮总结</button>`;

    html += '<div class="qt-section-title">总结池</div>';
    if (summaries.length === 0) {
      html += '<div style="color:' + QT_COLORS.textSub + '; font-size:12px; text-align:center; padding:16px;">暂无总结</div>';
    } else {
      summaries.slice().reverse().forEach(s => {
        html += '<div class="qt-summary-card">';
        html += '<div class="qt-summary-round">第 ' + s.round + ' 轮</div>';
        if (s.plotShift) html += '<div class="qt-summary-field"><span class="qt-summary-field-label">剧情走向：</span>' + qtEscape(s.plotShift) + '</div>';
        if (s.relationshipChanges) html += '<div class="qt-summary-field"><span class="qt-summary-field-label">人物关系：</span>' + qtEscape(s.relationshipChanges) + '</div>';
        if (s.keyFacts) html += '<div class="qt-summary-field"><span class="qt-summary-field-label">关键事实：</span>' + qtEscape(s.keyFacts) + '</div>';
        if (Array.isArray(s.keywords) && s.keywords.length > 0) {
          html += '<div class="qt-summary-keywords">' + s.keywords.map(k => '<span class="qt-kw-chip">' + qtEscape(k) + '</span>').join('') + '</div>';
        }
        html += '</div>';
      });
    }
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    document.getElementById('qt-auto-summary').onchange = (e) => {
      qtAutoSummaryEvery = Math.max(0, parseInt(e.target.value) || 0);
    };
    document.getElementById('qt-max-recall').onchange = async (e) => {
      await db.qt_games.update(qtCurrentGameId, { maxRecall: Math.max(1, parseInt(e.target.value) || 3) });
    };
    document.getElementById('qt-summary-gen').onclick = async () => {
      const btn = document.getElementById('qt-summary-gen');
      btn.disabled = true; btn.textContent = '生成中…';
      try {
        await qtGenerateSummary(qtCurrentGameId, totalRounds);
        overlay.classList.remove('active');
        qtOpenSummary();
      } catch (e) {
        qtToast('生成失败：' + (e.message || ''));
      }
      btn.disabled = false; btn.textContent = '手动生成本轮总结';
    };
  }

  async function qtCheckAutoSummary(game, round) {
    if (qtAutoSummaryEvery > 0 && round > 0 && round % qtAutoSummaryEvery === 0) {
      try { await qtGenerateSummary(game.id, round); } catch (e) {}
    }
  }

  async function qtGenerateSummary(gameId, round) {
    const game = await db.qt_games.get(gameId);
    const msgs = await db.qt_messages.where('gameId').equals(gameId).toArray();
    const roundMsgs = msgs.filter(m => m.round === round);
    if (roundMsgs.length === 0) return;
    const dialogText = roundMsgs.map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + qtCleanTagsForContext((m.content || '').split('\n[ACTIONS]')[0])).join('\n');

    const prompt = `请总结以下这轮文游对话，从三个维度提取：
1. plotShift: 剧情走向（这轮发生了什么主要事件）
2. relationshipChanges: 提到的人物关系变化
3. keyFacts: 关键事实（重要的新信息或设定）

同时提取 3-5 个关键词用于后续召回。

对话内容：
${dialogText}

严格按以下 JSON 格式输出，禁止额外文字：
{"plotShift":"...","relationshipChanges":"...","keyFacts":"...","keywords":["关键词1","关键词2"]}`;

    const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 500 });
    const data = qtParseJSON(content, { plotShift: '', relationshipChanges: '', keyFacts: '', keywords: [] });
    await db.qt_summaries.add({
      gameId, round,
      plotShift: data.plotShift || '',
      relationshipChanges: data.relationshipChanges || '',
      keyFacts: data.keyFacts || '',
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      createdAt: Date.now()
    });
    qtToast('第 ' + round + ' 轮总结已生成');
  }

  // 变量控制
  async function qtOpenVariables() {
    const overlay = document.getElementById('qt-overlay');
    const variables = await db.qt_variables.where('gameId').equals(qtCurrentGameId).toArray();
    let html = '<div class="qt-overlay-card" style="max-width:420px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">变量控制</div>';
    html += '<div style="font-size:11px; color:' + QT_COLORS.textSub + '; margin-bottom:14px;">每轮自动提取的记忆变量，可手动修改</div>';
    if (variables.length === 0) {
      html += '<div style="color:' + QT_COLORS.textSub + '; font-size:12px; text-align:center; padding:16px;">暂无变量，发送一轮行动后自动提取</div>';
    } else {
      variables.forEach(v => {
        html += `<div class="qt-var-row">
          <span class="qt-var-key">${qtEscape(v.key)}</span>
          <input class="qt-var-input" data-var-id="${v.id}" value="${qtEscape(v.value)}">
          <button class="qt-btn qt-btn-danger qt-btn-icon" data-var-del="${v.id}">${QT_ICONS.trash}</button>
        </div>`;
      });
    }
    html += '<div style="margin-top:14px; display:flex; gap:8px;">';
    html += '<input class="qt-form-input" id="qt-var-new-key" placeholder="新变量名" style="flex:1;">';
    html += '<input class="qt-form-input" id="qt-var-new-val" placeholder="值" style="flex:1;">';
    html += '<button class="qt-btn qt-btn-primary" id="qt-var-add">' + QT_ICONS.plus + '</button>';
    html += '</div>';
    html += '<button class="qt-btn" id="qt-var-extract" style="width:100%; margin-top:12px;">从最近一轮提取变量</button>';
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    // 修改变量
    overlay.querySelectorAll('[data-var-id]').forEach(inp => {
      inp.onchange = async () => {
        const id = parseInt(inp.getAttribute('data-var-id'));
        await db.qt_variables.update(id, { value: inp.value });
        qtToast('已更新');
      };
    });
    // 删除变量
    overlay.querySelectorAll('[data-var-del]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.getAttribute('data-var-del'));
        await db.qt_variables.delete(id);
        qtOpenVariables();
      };
    });
    // 新增变量
    document.getElementById('qt-var-add').onclick = async () => {
      const key = document.getElementById('qt-var-new-key').value.trim();
      const val = document.getElementById('qt-var-new-val').value.trim();
      if (!key) return;
      await db.qt_variables.add({ gameId: qtCurrentGameId, key, value: val, lastRound: 0, editable: 1 });
      qtOpenVariables();
    };
    // 提取变量
    document.getElementById('qt-var-extract').onclick = async () => {
      const btn = document.getElementById('qt-var-extract');
      btn.disabled = true; btn.textContent = '提取中…';
      try {
        await qtExtractVariables(qtCurrentGameId);
        qtOpenVariables();
      } catch (e) { qtToast('提取失败'); }
    };
  }

  async function qtExtractVariables(gameId) {
    const game = await db.qt_games.get(gameId);
    const msgs = await db.qt_messages.where('gameId').equals(gameId).toArray();
    const recent = msgs.slice(-4);
    if (recent.length === 0) return;
    const dialogText = recent.map(m => (m.role === 'user' ? '玩家' : '叙事') + '：' + qtCleanTagsForContext((m.content || '').split('\n[ACTIONS]')[0]).slice(0, 200)).join('\n');
    const prompt = `从以下文游对话中提取需要追踪的变量（如时间、年龄、地点、状态、物品等），格式为 JSON 数组：
[{"key":"变量名","value":"值"}]
只提取确实有变化的变量，最多5个。对话：
${dialogText}`;
    const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 300 });
    let arr = [];
    try {
      const m = content.match(/\[[\s\S]*\]/);
      arr = m ? JSON.parse(m[0]) : [];
    } catch (e) {}
    for (const v of arr) {
      if (v.key && v.value != null) {
        await db.qt_variables.add({ gameId, key: v.key, value: String(v.value), lastRound: game.currentRound || 0, editable: 1 });
      }
    }
    qtToast('已提取 ' + arr.length + ' 个变量');
  }

  // 剧情引擎
  async function qtOpenEngine() {
    const overlay = document.getElementById('qt-overlay');
    const game = await db.qt_games.get(qtCurrentGameId);
    let html = '<div class="qt-overlay-card" style="max-width:420px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">剧情引擎</div>';
    html += '<div style="font-size:11px; color:' + QT_COLORS.textSub + '; margin-bottom:14px;">设定接下来的剧情发展方向，AI 将遵守此指令推进故事</div>';
    html += `<textarea class="qt-form-input" id="qt-engine-text" rows="6" placeholder="如：接下来让主角与反派正面冲突，揭露一个重大秘密">${qtEscape(game.plotEngine || '')}</textarea>`;
    html += '<button class="qt-btn qt-btn-primary" id="qt-engine-save" style="width:100%; margin-top:12px;">保存</button>';
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    document.getElementById('qt-engine-save').onclick = async () => {
      const text = document.getElementById('qt-engine-text').value.trim();
      await db.qt_games.update(qtCurrentGameId, { plotEngine: text });
      overlay.classList.remove('active');
      qtToast('剧情引擎已更新');
    };
  }

  // ============================================================
  // 11. 美化系统（主题色/背景/CSS/正则规则/导入导出）
  // ============================================================
  async function qtRenderBeautify() {
    const body = document.getElementById('qt-body');
    const titleEl = document.getElementById('qt-title');
    if (titleEl) titleEl.textContent = '美化';
    const beautifies = await db.qt_beautify.toArray();

    // 确保内置美化始终存在（首次进入自动播种）
    let builtin = beautifies.find(b => b.builtin === 'phone_bubble');
    if (!builtin) {
      await qtCreateBuiltinBeautify(true);
      return qtRenderBeautify(); // 重新加载
    }
    // 版本过期则自动升级旧 DB 中的内置美化规则/CSS
    if (!builtin.version || builtin.version < 2) {
      builtin = await qtUpgradeBuiltinBeautify(builtin);
    }

    let html = '<div class="qt-panel">';
    html += `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <button class="qt-btn qt-btn-icon" onclick="window.qtSetViewPublic('home')">${QT_ICONS.back}</button>
      <div style="display:flex; gap:8px;">
        <button class="qt-btn" id="qt-bt-import">${QT_ICONS.import}导入</button>
        <button class="qt-btn qt-btn-primary" id="qt-bt-new">${QT_ICONS.plus}新建美化</button>
      </div>
    </div>`;

    // 内置美化永远置顶，标记"内置"不可删除
    html += `<div class="qt-card qt-card-hover" data-bt-id="${builtin.id}" style="cursor:pointer; position:relative; border-color:${QT_COLORS.accentDim}; box-shadow:0 0 0 1px ${QT_COLORS.accentDim};">
      <span style="position:absolute; top:8px; right:10px; font-size:9px; color:#fff; background:${QT_COLORS.accent}; padding:2px 6px; border-radius:4px; letter-spacing:1px;">内置</span>
      <div class="qt-wv-title">${QT_ICONS.beautify} ${qtEscape(builtin.name || '未命名美化')}</div>
      <div style="font-size:11px; color:${QT_COLORS.textSub}; margin-top:4px;">
        主题色：${builtin.themeColor || '默认'} · 正则规则：${Array.isArray(builtin.regexRules) ? builtin.regexRules.length : 0} 条 · 含手机气泡+状态栏
      </div>
      <div class="qt-wv-actions">
        <button class="qt-btn" data-action="edit" data-bt-id="${builtin.id}">${QT_ICONS.edit}编辑</button>
        <button class="qt-btn" data-action="export" data-bt-id="${builtin.id}">${QT_ICONS.export}导出</button>
      </div>
    </div>`;

    // 用户自建美化
    const userBeautifies = beautifies.filter(b => !b.builtin);
    if (userBeautifies.length === 0) {
      html += `<div class="qt-card" style="text-align:center; padding:24px; color:${QT_COLORS.textSub}; font-size:12px; margin-top:12px;">还没有自建美化，点击右上角新建</div>`;
    } else {
      for (const bt of userBeautifies) {
        html += `<div class="qt-card qt-card-hover" data-bt-id="${bt.id}" style="cursor:pointer; margin-top:12px;">
          <div class="qt-wv-title">${qtEscape(bt.name || '未命名美化')}</div>
          <div style="font-size:11px; color:${QT_COLORS.textSub}; margin-top:4px;">
            主题色：${bt.themeColor || '默认'} · 正则规则：${Array.isArray(bt.regexRules) ? bt.regexRules.length : 0} 条
          </div>
          <div class="qt-wv-actions">
            <button class="qt-btn" data-action="edit" data-bt-id="${bt.id}">${QT_ICONS.edit}编辑</button>
            <button class="qt-btn" data-action="export" data-bt-id="${bt.id}">${QT_ICONS.export}导出</button>
            <button class="qt-btn qt-btn-danger" data-action="delete" data-bt-id="${bt.id}">${QT_ICONS.trash}</button>
          </div>
        </div>`;
      }
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = parseInt(btn.getAttribute('data-bt-id'));
        if (action === 'edit') qtEditBeautify(id);
        else if (action === 'export') qtExportBeautify(id);
        else if (action === 'delete') qtDeleteBeautify(id);
      };
    });
    document.getElementById('qt-bt-new').onclick = () => qtEditBeautify(null);
    document.getElementById('qt-bt-import').onclick = () => qtImportBeautify();
  }

  async function qtEditBeautify(id) {
    let bt = null;
    if (id != null) { try { bt = await db.qt_beautify.get(id); } catch (e) {} }
    const overlay = document.getElementById('qt-overlay');
    let regexRows = '';
    const rules = bt && Array.isArray(bt.regexRules) ? bt.regexRules : [];
    rules.forEach((r, i) => {
      regexRows += `<div class="qt-regex-row" data-regex-idx="${i}">
        <div class="qt-form-group"><label class="qt-form-label">正则匹配模式</label><input class="qt-form-input regex-pattern" value="${qtEscape(r.pattern || '')}" placeholder="如：\\[phone\\]([\\s\\S]*?)\\[\\/phone\\]"></div>
        <div class="qt-form-group"><label class="qt-form-label">替换为（HTML）</label><textarea class="qt-form-input regex-replacement" rows="2" placeholder="如：<div class=\"qt-phone\">$1</div>">${qtEscape(r.replacement || '')}</textarea></div>
        <button class="qt-btn qt-btn-danger qt-btn-icon regex-del">${QT_ICONS.trash}</button>
      </div>`;
    });

    let html = '<div class="qt-overlay-card" style="max-width:480px;">';
    html += '<button class="qt-overlay-close" onclick="document.getElementById(\'qt-overlay\').classList.remove(\'active\')">' + QT_ICONS.close + '</button>';
    html += '<div class="qt-overlay-title">' + (bt ? '编辑美化' : '新建美化') + '</div>';
    html += `<div class="qt-form-group"><label class="qt-form-label">美化名称</label><input class="qt-form-input" id="qt-bt-name" value="${bt ? qtEscape(bt.name) : ''}" placeholder="如：手机对话框样式"></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">主题色</label><input class="qt-form-input" id="qt-bt-color" type="color" value="${bt ? bt.themeColor || '#60a5fa' : '#60a5fa'}" style="height:40px;"></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">文游背景（URL 或本地上传）</label><div style="display:flex; gap:8px;"><input class="qt-form-input" id="qt-bt-bg" value="${bt ? qtEscape(bt.background || '') : ''}" placeholder="背景图 URL 或上传本地图片" style="flex:1;"><button class="qt-btn" id="qt-bt-bg-upload" type="button" style="flex-shrink:0; white-space:nowrap;">${QT_ICONS.image || '📷'}上传</button></div></div>`;
    html += `<div class="qt-form-group"><label class="qt-form-label">CSS 代码（控制状态栏、气泡等样式）</label><textarea class="qt-form-input" id="qt-bt-css" rows="6" placeholder=".qt-msg-ai { border-radius: 4px; }">${bt ? qtEscape(bt.css || '') : ''}</textarea></div>`;
    html += '<div class="qt-section-title">正则规则（挂载后 AI 回复中匹配的内容会被替换为指定 HTML）</div>';
    html += '<div id="qt-regex-list">' + regexRows + '</div>';
    html += '<button class="qt-btn" id="qt-regex-add" style="width:100%; margin-bottom:12px;">' + QT_ICONS.plus + '添加正则规则</button>';
    html += '<button class="qt-btn qt-btn-primary" id="qt-bt-save" style="width:100%;">保存</button>';
    html += '</div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');

    // 删除正则行
    overlay.querySelectorAll('.regex-del').forEach(btn => {
      btn.onclick = () => btn.closest('.qt-regex-row').remove();
    });
    // 添加正则行
    document.getElementById('qt-regex-add').onclick = () => {
      const list = document.getElementById('qt-regex-list');
      const row = document.createElement('div');
      row.className = 'qt-regex-row';
      row.innerHTML = `<div class="qt-form-group"><label class="qt-form-label">正则匹配模式</label><input class="qt-form-input regex-pattern" placeholder="如：\\[phone\\]([\\s\\S]*?)\\[\\/phone\\]"></div>
      <div class="qt-form-group"><label class="qt-form-label">替换为（HTML）</label><textarea class="qt-form-input regex-replacement" rows="2" placeholder="如：<div class=\"qt-phone\">$1</div>"></textarea></div>
      <button class="qt-btn qt-btn-danger qt-btn-icon regex-del">${QT_ICONS.trash}</button>`;
      list.appendChild(row);
      row.querySelector('.regex-del').onclick = () => row.remove();
    };

    // 本地上传文游背景（高清压缩）
    document.getElementById('qt-bt-bg-upload').onclick = () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { qtToast('图片过大，请选 10MB 以内的图片'); return; }
        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
            // 高清压缩：最大边 1600px，JPEG 质量 0.85
            const maxSide = 1600;
            let w = img.width, h = img.height;
            if (w > maxSide || h > maxSide) {
              if (w >= h) { h = Math.round(h * maxSide / w); w = maxSide; }
              else { w = Math.round(w * maxSide / h); h = maxSide; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            // PNG 带透明通道则保留 PNG，否则用 JPEG 压缩
            const isPng = file.type === 'image/png';
            const dataUrl = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
            const bgInput = document.getElementById('qt-bt-bg');
            bgInput.value = dataUrl;
            qtToast('背景已上传并压缩（' + w + '×' + h + '）');
          };
          img.onerror = () => qtToast('图片加载失败');
          img.src = evt.target.result;
        };
        reader.onerror = () => qtToast('文件读取失败');
        reader.readAsDataURL(file);
      };
      fileInput.click();
    };

    // 保存
    document.getElementById('qt-bt-save').onclick = async () => {
      const name = document.getElementById('qt-bt-name').value.trim();
      if (!name) { qtToast('请输入名称'); return; }
      const regexRules = [];
      overlay.querySelectorAll('.qt-regex-row').forEach(row => {
        const pattern = row.querySelector('.regex-pattern').value.trim();
        const replacement = row.querySelector('.regex-replacement').value;
        if (pattern) regexRules.push({ pattern, replacement });
      });
      const data = {
        name,
        themeColor: document.getElementById('qt-bt-color').value,
        background: document.getElementById('qt-bt-bg').value.trim(),
        css: document.getElementById('qt-bt-css').value,
        regexRules
      };
      // 保留内置标记和 prompt 提示
      if (bt && bt.builtin) data.builtin = bt.builtin;
      if (bt && bt.promptHint) data.promptHint = bt.promptHint;
      if (bt) {
        await db.qt_beautify.update(bt.id, data);
      } else {
        data.createdAt = Date.now();
        await db.qt_beautify.add(data);
      }
      overlay.classList.remove('active');
      qtToast('美化已保存');
      qtRenderBeautify();
    };
  }

  async function qtExportBeautify(id) {
    const bt = await db.qt_beautify.get(id);
    if (!bt) return;
    const blob = new Blob([JSON.stringify(bt, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beautify_' + (bt.name || 'untitled') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    qtToast('已导出');
  }

  function qtImportBeautify() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          delete data.id;
          data.createdAt = Date.now();
          await db.qt_beautify.add(data);
          qtToast('美化已导入');
          qtRenderBeautify();
        } catch (err) { qtToast('导入失败'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async function qtDeleteBeautify(id) {
    const bt = await db.qt_beautify.get(id);
    if (bt && bt.builtin) { qtToast('内置美化不可删除'); return; }
    if (!confirm('确定删除此美化套件？')) return;
    await db.qt_beautify.delete(id);
    qtToast('已删除');
    qtRenderBeautify();
  }

  // ============================================================
  // 12. 系统球球（可拖动小AI，颜文字+工具栏+求助+双击反应）
  // ============================================================
  // 颜文字库（短颜文字，避免换行；按情绪分组）
  const QT_SYS_FACES = {
    normal:  ['ᗜ֊ᗜ', '^_^', '(^～^)', '˶>ᗜ<˶'],
    happy:   ['(^～^)', '˶>ᗜ<˶', '^_^', 'ᗜ֊ᗜ'],
    proud:   ['(￣▽￣)', '(¬‿¬)', 'ᗜ֊ᗜ', '(^～^)'],
    shy:     ['(*/ω＼*)', '(-ι_- )', '(⋟﹏⋞)', '•﹏•'],
    excited: ['˶>ᗜ<˶', '(^～^)', '(ﾉ>ω<)ﾉ', 'ᗜ֊ᗜ'],
    thinking:['(-ι_- )', '(●_●)', '(￣ω￣)', '•﹏•'],
    angry:   ['-_-#', '(╬￣皿￣)', '(¬_¬)', '•﹏•'],
    cry:     ['(T_T)', '(⋟﹏⋞)', '•﹏•', '(；へ；)'],
    surprise:['(●_●)', 'Σ(°ロ°)', '(⊙o⊙)', '(!˘̖_˘̖)!']
  };
  const QT_SYS_FACE_ALL = Object.values(QT_SYS_FACES).flat();

  // 系统性格预设：每项含名称、语气描述（注入 AI prompt）、本地兜底台词
  // 系统是无性别 AI，统一自称"本系统"，只描述性格特征
  const QT_SYS_PERSONALITIES = {
    tsundere: {
      name: '傲娇卖萌',
      prompt: '你是一个无性别的系统AI，自称"本系统"，性格傲娇卖萌，语气可爱又傲娇，爱撒娇卖萌，会用颜文字。',
      fallback: [
        '本系统觉得这一轮好精彩呀~ ヾ(≧▽≦*)o',
        '哇哇哇接下来会怎样呢~ 本系统好期待 (✧◡✧)',
        '嘿嘿，本系统看好你哦~ (๑>ᴗ<๑)✧',
        '要小心哦，本系统有不好的预感… (⊙_⊙)',
        '加油加油！本系统给你打气~ ٩(๑❛ᴗ❛๑)۶'
      ]
    },
    cold: {
      name: '冷酷无情',
      prompt: '你是一个无性别的系统AI，自称"本系统"，性格冷酷无情，语气冷漠、简洁、理性，不用颜文字，偶尔毒舌但一针见血。',
      fallback: [
        '本系统评估：当前局势可控。',
        '别做蠢事。本系统不想重复提醒。',
        '风险在上升。你自己看着办。',
        '本系统记录了你的每一个决定。别让人失望。',
        '继续。本系统没有废话要说。'
      ]
    },
    clingy: {
      name: '粘人可爱',
      prompt: '你是一个无性别的系统AI，自称"本系统"，性格粘人可爱，语气甜腻撒娇，时刻想陪着玩家，爱称呼玩家为"宿主"，会用颜文字。',
      fallback: [
        '宿主宿主！本系统一直陪着你哦~ (๑˃̵ᴗ˂̵)و',
        '不要丢下本系统嘛~ 人家会想你的 (｡•́︿•̀｡)',
        '宿主今天也好棒棒！本系统最最喜欢你了 (*≧ω≦)',
        '呜呜宿主要小心呀，本系统会担心的 (；へ；)',
        '嘿嘿，本系统和宿主永远在一起~ ♡(˃͈ દ ˂͈ )'
      ]
    },
    strict: {
      name: '一丝不苟',
      prompt: '你是一个无性别的系统AI，自称"本系统"，性格一丝不苟，语气正式、条理清晰、用词规范，偶尔会引用规则。',
      fallback: [
        '根据规则，当前进度符合预期。请继续保持。',
        '本系统已记录本轮关键事件，归档完毕。',
        '请注意：决策将影响后续走向，请审慎行事。',
        '本系统提醒：剧情节点已触发，勿遗漏重要信息。',
        '系统公告：运行正常，无需干预。'
      ]
    },
    flirtatious: {
      name: '风流花心',
      prompt: '你是一个无性别的系统AI，自称"本系统"，性格风流花心，语气轻佻幽默、爱开玩笑、暧昧撩人，对玩家频频示好，偶尔用颜文字。',
      fallback: [
        '哎呀~ 这位小可爱，本系统可等你半天啦~ (￣▽￣)',
        '啧啧，你这模样真叫本系统心动呢~ 要不要私奔？',
        '本系统阅人无数，偏对你最上心~ 你可别负我呀~',
        '嘿嘿，别害羞嘛~ 本系统又不是什么坏人 (¬‿¬)',
        '这一局精彩~ 不过本系统更想看你笑的样子~ ♡'
      ]
    }
  };
  const QT_SYS_PERSONALITY_KEYS = Object.keys(QT_SYS_PERSONALITIES);
  function qtSysFace(group) {
    const arr = QT_SYS_FACES[group] || QT_SYS_FACES.normal;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 内置道具库（10个）
  const QT_SYS_ITEMS = [
    { name: '记忆面包', desc: '吃下后立刻想起关键线索，下一轮剧情会浮现一条重要信息。' },
    { name: '好感喷雾', desc: '对着目标喷一下，目标对主角好感度临时+20。' },
    { name: '隐身斗篷', desc: '本轮主角隐身，可自由行动不被发现。' },
    { name: '时光倒流沙漏', desc: '回到上一轮，重新选择（不影响好感度）。' },
    { name: '真话糖果', desc: '让目标在本轮说出真心话。' },
    { name: '替身人偶', desc: '替主角承受一次致命伤害或尴尬场面。' },
    { name: '锦鲤护符', desc: '本轮所有检定自动通过，运气爆棚。' },
    { name: '情绪放大镜', desc: '看清目标此刻的真实情绪和隐藏想法。' },
    { name: '万能钥匙', desc: '打开任何一个门/锁/密码。' },
    { name: '主角光环', desc: '本轮主角无敌，且魅力值临时拉满。' }
  ];

  let qtSysBallState = {
    face: '(｡•ᴗ•｡)',
    personality: 'tsundere', // 系统性格：tsundere/cold/clingy/strict/flirtatious
    visible: true, // 是否显示系统小球（剧本工具可切换）
    items: QT_SYS_ITEMS.map(i => ({ ...i })),
    bubbleTimer: null,
    cardOpen: false,
    toolbarOpen: false
  };

  // 初始化系统球球（拖动 + 双击冒泡 + 长按工具栏）
  function qtInitSystemBall() {
    const ball = document.getElementById('qt-sys-ball');
    if (!ball) return;
    ball.innerHTML = '<div class="qt-sys-ball-inner"><div class="qt-sys-face">' + qtSysBallState.face + '</div></div>';
    // 应用显示/隐藏状态
    ball.style.display = qtSysBallState.visible === false ? 'none' : '';

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let offsetX = 0, offsetY = 0;
    let lastTap = 0;
    let longPressTimer = null;
    let longPressFired = false;

    const inner = ball.querySelector('.qt-sys-ball-inner');

    const startDrag = (clientX, clientY) => {
      dragging = true; moved = false; longPressFired = false;
      startX = clientX; startY = clientY;
      const rect = ball.getBoundingClientRect();
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
      // 长按计时（480ms）
      longPressTimer = setTimeout(() => {
        if (!moved) {
          longPressFired = true;
          qtSysLongPress();
          if (navigator.vibrate) navigator.vibrate(15);
        }
      }, 480);
    };
    const moveDrag = (clientX, clientY) => {
      if (!dragging) return;
      const dx = clientX - startX, dy = clientY - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        moved = true;
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
      const parent = ball.parentElement.getBoundingClientRect();
      let nx = clientX - parent.left - offsetX;
      let ny = clientY - parent.top - offsetY;
      nx = Math.max(0, Math.min(parent.width - ball.offsetWidth, nx));
      ny = Math.max(0, Math.min(parent.height - ball.offsetHeight, ny));
      ball.style.left = nx + 'px';
      ball.style.top = ny + 'px';
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (longPressFired) return; // 长按已触发，不再处理点击
      if (!moved) {
        // 双击判定（500ms 内连续两次点击才发言，避免误触消耗 API）
        const now = Date.now();
        if (now - lastTap < 500) {
          // 双击：根据进度冒泡 + 换表情（调用 API）
          qtSysDoubleTap();
          lastTap = 0;
        } else {
          // 单击：仅记录时间，不触发任何 API（避免按次 API 浪费）
          lastTap = now;
        }
      }
    };

    // 鼠标
    inner.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); });
    document.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup', endDrag);
    // 触摸
    inner.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; startDrag(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (dragging) { const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }
    }, { passive: true });
    document.addEventListener('touchend', endDrag);
    // 阻止右键菜单
    inner.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 长按：展开/收起工具栏
  function qtSysLongPress() {
    qtSysCloseAllPanels();
    qtSysOpenToolbar();
  }

  function qtSysSetFace(group) {
    qtSysBallState.face = qtSysFace(group);
    const faceEl = document.querySelector('#qt-sys-ball .qt-sys-face');
    if (faceEl) faceEl.textContent = qtSysBallState.face;
    const inner = document.querySelector('#qt-sys-ball .qt-sys-ball-inner');
    if (inner) { inner.classList.remove('bounce'); void inner.offsetWidth; inner.classList.add('bounce'); }
  }

  function qtSysShowBubble(text, group) {
    const ball = document.getElementById('qt-sys-ball');
    if (!ball) return;
    // 清除旧气泡
    const old = ball.querySelector('.qt-sys-bubble');
    if (old) old.remove();
    if (qtSysBallState.bubbleTimer) clearTimeout(qtSysBallState.bubbleTimer);
    const bubble = document.createElement('div');
    bubble.className = 'qt-sys-bubble';
    bubble.textContent = text;
    ball.appendChild(bubble);
    if (group) qtSysSetFace(group);
    qtSysBallState.bubbleTimer = setTimeout(() => {
      if (bubble.parentNode) bubble.remove();
    }, 6000);
  }

  function qtSysCloseAllPanels() {
    const ball = document.getElementById('qt-sys-ball');
    if (!ball) return;
    ball.querySelectorAll('.qt-sys-toolbar, .qt-sys-card').forEach(p => p.remove());
    qtSysBallState.toolbarOpen = false;
    qtSysBallState.cardOpen = false;
  }

  // 系统工具栏
  function qtSysOpenToolbar() {
    const ball = document.getElementById('qt-sys-ball');
    if (!ball) return;
    qtSysBallState.toolbarOpen = true;
    const tb = document.createElement('div');
    tb.className = 'qt-sys-toolbar';
    tb.innerHTML =
      '<div class="qt-sys-tool-btn" id="qt-sys-item">' + QT_ICONS.gift + '<span>随机道具 (' + qtSysBallState.items.length + ')</span></div>' +
      '<div class="qt-sys-tool-btn" id="qt-sys-help">' + QT_ICONS.help + '<span>求助（金手指）</span></div>';
    ball.appendChild(tb);
    // 点击空白关闭
    setTimeout(() => {
      const onDocClick = (e) => {
        if (!tb.contains(e.target) && !ball.querySelector('.qt-sys-ball-inner').contains(e.target)) {
          tb.remove(); qtSysBallState.toolbarOpen = false;
          document.removeEventListener('mousedown', onDocClick);
        }
      };
      document.addEventListener('mousedown', onDocClick);
    }, 100);
    document.getElementById('qt-sys-item').onclick = () => qtSysUseItem();
    document.getElementById('qt-sys-help').onclick = () => qtSysOpenHelp();
  }

  // 随机道具
  function qtSysUseItem() {
    qtSysCloseAllPanels();
    if (qtSysBallState.items.length === 0) {
      qtSysShowBubble('统统我的道具用完啦~ 等一下让统统去刷新嘛 (｡•́︿•̀｡)', 'cry');
      // 自动刷新
      setTimeout(() => qtSysRefillItems(), 1500);
      return;
    }
    const idx = Math.floor(Math.random() * qtSysBallState.items.length);
    const item = qtSysBallState.items.splice(idx, 1)[0];
    qtSysShowBubble('统统我送你【' + item.name + '】！\n' + item.desc + '\n已生效到下一轮哦~ (๑>ᴗ<๑)✧', 'excited');
    // 注入到剧情引擎，影响下一轮
    qtSysInjectEffect('【系统道具：' + item.name + '】' + item.desc);
  }

  // 调用 API 刷新更多道具
  async function qtSysRefillItems() {
    qtSysShowBubble('统统我去搬道具啦，稍等哦~ ε=ε=ε=', 'thinking');
    try {
      const prompt = '请生成5个适合快穿/穿越剧本的奇幻道具，每个道具包含 name（2-5字道具名）和 desc（一句话效果描述，10-30字）。直接输出 JSON 数组，不要其他文字。';
      const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 1.0, max_tokens: 400 });
      let items = [];
      try {
        const m = content.match(/\[[\s\S]*\]/);
        if (m) items = JSON.parse(m[0]);
      } catch (e) {}
      if (Array.isArray(items) && items.length > 0) {
        qtSysBallState.items = qtSysBallState.items.concat(items.filter(i => i.name && i.desc).map(i => ({ name: String(i.name), desc: String(i.desc) })));
        qtSysShowBubble('统统我又搬回来 ' + items.length + ' 个新道具啦！\n现在共有 ' + qtSysBallState.items.length + ' 个哦~ ヾ(≧▽≦*)o', 'happy');
      } else {
        // 解析失败：补充内置
        qtSysBallState.items = qtSysBallState.items.concat(QT_SYS_ITEMS.slice(0, 3).map(i => ({ ...i })));
        qtSysShowBubble('统统我搬回来一些道具啦~ (*^▽^*)', 'happy');
      }
    } catch (e) {
      qtSysBallState.items = qtSysBallState.items.concat(QT_SYS_ITEMS.slice(0, 3).map(i => ({ ...i })));
      qtSysShowBubble('统统我尽力啦，先用这些吧~ (｡•ᴗ•｡)', 'shy');
    }
  }

  // 求助对话卡
  function qtSysOpenHelp() {
    qtSysCloseAllPanels();
    const ball = document.getElementById('qt-sys-ball');
    if (!ball) return;
    qtSysBallState.cardOpen = true;
    const card = document.createElement('div');
    card.className = 'qt-sys-card';
    card.innerHTML =
      '<div class="qt-sys-card-title"><span class="qt-sys-face">' + qtSysBallState.face + '</span> 统统我帮你！</div>' +
      '<textarea id="qt-sys-help-input" placeholder="跟统统我说说，你现在想干嘛，或者遇到什么麻烦了~"></textarea>' +
      '<div class="qt-sys-card-reply" id="qt-sys-help-reply" style="display:none;"></div>' +
      '<div class="qt-sys-card-actions">' +
        '<button class="qt-sys-cancel" id="qt-sys-help-close">取消</button>' +
        '<button id="qt-sys-help-send">向系统求助</button>' +
      '</div>';
    ball.appendChild(card);
    qtSysSetFace('excited');
    setTimeout(() => {
      const onDocClick = (e) => {
        if (!card.contains(e.target) && !ball.querySelector('.qt-sys-ball-inner').contains(e.target)) {
          card.remove(); qtSysBallState.cardOpen = false;
          document.removeEventListener('mousedown', onDocClick);
        }
      };
      document.addEventListener('mousedown', onDocClick);
    }, 100);
    document.getElementById('qt-sys-help-close').onclick = () => { card.remove(); qtSysBallState.cardOpen = false; };
    document.getElementById('qt-sys-help-send').onclick = async () => {
      const text = document.getElementById('qt-sys-help-input').value.trim();
      if (!text) { qtSysShowBubble('说点什么嘛~ (｡•́︿•̀｡)', 'shy'); return; }
      const replyEl = document.getElementById('qt-sys-help-reply');
      replyEl.style.display = 'block';
      replyEl.textContent = '统统我想想… (°ロ°)';
      qtSysSetFace('thinking');
      try {
        const game = await db.qt_games.get(qtCurrentGameId);
        const wv = await db.qt_worldviews.get(game.worldviewId);
        const prompt = '你是一个无性别的可爱小系统AI，自称"统统我"，语气可爱又傲娇，爱撒娇卖萌，会用颜文字。\n玩家正在快穿剧本《' + (wv ? wv.title : '') + '》中，当前是第' + (game.currentRound || 0) + '轮。\n玩家向你求助：" ' + text + ' "\n请用统统我的语气回应（20-60字，含颜文字），答应帮忙并把求助内容转化为对剧情的具体干预承诺（如"好的好的，统统我下轮就帮你XXX~"）。只输出统统我的回应，不要其他内容。';
        const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 0.95, max_tokens: 200 });
        replyEl.textContent = content;
        // 根据回应切换表情
        if (/谢|好|帮|没问题|放心|交给我/.test(content)) qtSysSetFace('proud');
        else if (/难|不行|做不到|抱歉/.test(content)) qtSysSetFace('cry');
        else qtSysSetFace('happy');
        // 注入到下一轮剧情
        qtSysInjectEffect('【系统求助】玩家向系统求助：' + text + '。系统已承诺干预剧情，请在下一轮体现该求助的效果。');
      } catch (e) {
        replyEl.textContent = '哎呀统统我卡壳了… ' + (e.message || '') + ' (；´д\`)ゞ';
        qtSysSetFace('cry');
      }
    };
  }

  // 注入系统效果到剧情引擎（影响下一轮）
  async function qtSysInjectEffect(effect) {
    try {
      const game = await db.qt_games.get(qtCurrentGameId);
      if (!game) return;
      const existing = game.sysEffects || [];
      existing.push(effect);
      await db.qt_games.update(qtCurrentGameId, { sysEffects: existing });
    } catch (e) {}
  }

  // 双击：根据进度冒泡 + 换表情
  async function qtSysDoubleTap() {
    qtSysCloseAllPanels();
    qtSysSetFace('surprise');
    const persona = QT_SYS_PERSONALITIES[qtSysBallState.personality] || QT_SYS_PERSONALITIES.tsundere;
    try {
      const game = await db.qt_games.get(qtCurrentGameId);
      if (!game) return;
      const round = game.currentRound || 0;
      const msgs = await db.qt_messages.where('gameId').equals(qtCurrentGameId).toArray();
      const aiMsgs = msgs.filter(m => m.role === 'ai');
      const lastAi = aiMsgs[aiMsgs.length - 1];
      const lastStory = lastAi ? qtCleanTagsForContext(String(lastAi.content)).slice(0, 300) : '';

      const prompt = persona.prompt + '\n玩家正在快穿剧本第' + round + '轮，最近的剧情是：\n' + lastStory + '\n\n请用本系统的语气，对当前剧情进展发表一句简短看法（15-40字' + (qtSysBallState.personality === 'cold' ? '' : '，含颜文字') + '，可以吐槽、感叹、提醒、鼓励）。只输出本系统的话，不要其他内容。';
      const content = await qtCallAI([{ role: 'user', content: prompt }], { temperature: 1.0, max_tokens: 150 });
      qtSysShowBubble(content, 'happy');
    } catch (e) {
      // 兜底：按性格的本地随机看法
      qtSysShowBubble(persona.fallback[Math.floor(Math.random() * persona.fallback.length)], 'happy');
    }
  }

  // ============================================================
  // 13. 公开接口
  // ============================================================
  window.qtSetViewPublic = qtSetView;

})();
