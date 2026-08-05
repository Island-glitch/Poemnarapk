/**
 * ============================================================
 * app_chat_beautify.js - 叙事诗小手机：聊天个性化美化控制中心 (全维度样式隔离、头像与消息间距可调、形心指向小尾巴升级版)
 * ============================================================
 */
(function() {
  const defaultConfig = {
    bgUrl: "",
    char: {
      avatarRadius: 12, 
      avatarSize: 40,
      bubblePaddingTB: 10,
      bubblePaddingLR: 14,
      avatarSpacing: 10, 
      bubbleRadiusTL: 12, 
      bubbleRadiusTR: 12,
      bubbleRadiusBL: 12,
      bubbleRadiusBR: 12,
      bubbleBorderColor: "#e2e8f0",
      bubbleBgColor: "#ffffff",
      bubbleBgOpacity: 1.0,
      textColor: "#191919",
      pendantUrl: "",
      pendantX: 0,
      pendantY: 0,
      pendantSize: 20,
      tailToggle: 1, 
      tailLength: 10,
      tailY: 80,
      tailPointToAvatarCenter: 1 // 默认开启指向头像形心 [1]
    },
    user: {
      avatarRadius: 12,
      avatarSize: 40,
      bubblePaddingTB: 10,
      bubblePaddingLR: 14,
      avatarSpacing: 10, 
      bubbleRadiusTL: 12, 
      bubbleRadiusTR: 12,
      bubbleRadiusBL: 12,
      bubbleRadiusBR: 12,
      bubbleBorderColor: "#e2e8f0",
      bubbleBgColor: "#95ec69",
      bubbleBgOpacity: 1.0,
      textColor: "#191919",
      pendantUrl: "",
      pendantX: 0,
      pendantY: 0,
      pendantSize: 20,
      tailToggle: 1,
      tailLength: 10,
      tailY: 80,
      tailPointToAvatarCenter: 1 // 默认开启指向头像形心 [1]
    },
    customCss: ""
  };

  let activeConfig = JSON.parse(JSON.stringify(defaultConfig));
  let activeTab = "char";
  let activePendantTab = "char";

  const chatBeautifySystem = {
    openPanel: async function() {
      if (!activeSessionId) {
        showToast("当前无活跃会话，无法美化！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      if (sess && sess.beautifyConfig) {
        try {
          activeConfig = JSON.parse(sess.beautifyConfig);
        } catch(e) {
          activeConfig = JSON.parse(JSON.stringify(defaultConfig));
        }
      } else {
        activeConfig = JSON.parse(JSON.stringify(defaultConfig));
      }

      document.getElementById("beautify-chat-bg-url").value = activeConfig.bgUrl.startsWith("data:") ? "[本地上传背景]" : activeConfig.bgUrl;
      document.getElementById("beautify-custom-css-editor").value = activeConfig.customCss || "";

      chatBeautifySystem.loadPresetsDropdown();
      chatBeautifySystem.switchTab("char");
      chatBeautifySystem.switchPendantTab("char");
      chatBeautifySystem.updatePreview();

      document.getElementById("chat-beautify-panel").classList.add("active");
    },

    closePanel: function() {
      document.getElementById("chat-beautify-panel").classList.remove("active");
    },

    toggleSection: function(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) return;
      const body = section.querySelector(".section-content-body");
      const chevron = section.querySelector(".chevron-icon");
      if (body && chevron) {
        if (body.style.display === "none") {
          body.style.display = "block";
          chevron.style.transform = "rotate(180deg)";
        } else {
          body.style.display = "none";
          chevron.style.transform = "rotate(0deg)";
        }
      }
    },

    switchTab: function(tab) {
      activeTab = tab;
      const btnChar = document.getElementById("tab-trigger-char");
      const btnUser = document.getElementById("tab-trigger-user");

      if (tab === "char") {
        btnChar.style.backgroundColor = "#ef4444";
        btnUser.style.backgroundColor = "#94a3b8";
      } else {
        btnChar.style.backgroundColor = "#94a3b8";
        btnUser.style.backgroundColor = "#07c160";
      }

      chatBeautifySystem.syncSlidersFromConfig();
    },

    switchPendantTab: function(tab) {
      activePendantTab = tab;
      const btnChar = document.getElementById("pendant-trigger-char");
      const btnUser = document.getElementById("pendant-trigger-user");

      if (tab === "char") {
        btnChar.style.backgroundColor = "#ef4444";
        btnUser.style.backgroundColor = "#94a3b8";
      } else {
        btnChar.style.backgroundColor = "#94a3b8";
        btnUser.style.backgroundColor = "#07c160";
      }

      chatBeautifySystem.syncPendantSlidersFromConfig();
    },

    syncSlidersFromConfig: function() {
      const data = activeConfig[activeTab];
      const props = [
        "avatarRadius", "avatarSize", "bubblePaddingTB", "bubblePaddingLR", "avatarSpacing",
        "bubbleRadiusTL", "bubbleRadiusTR", "bubbleRadiusBL", "bubbleRadiusBR",
        "bubbleBgOpacity", "tailLength", "tailY"
      ];

      props.forEach(p => {
        const slider = document.getElementById(`slider-${p}`);
        const label = document.getElementById(`slider-val-${p}`);
        if (slider && label) {
          slider.value = data[p] ?? defaultConfig[activeTab][p];
          
          if (p === "avatarRadius" || p.startsWith("bubbleRadius") || p === "tailY") {
            label.innerText = `${slider.value}%`;
          } else if (p.includes("Opacity")) {
            label.innerText = slider.value;
          } else {
            label.innerText = `${slider.value}px`;
          }
        }
      });

      // 同步小尾巴开关与拉条显示
      const toggleInput = document.getElementById("slider-tailToggle");
      if (toggleInput) {
        toggleInput.checked = (data.tailToggle !== 0);
      }
      const controlsContainer = document.getElementById("beautify-tail-controls");
      if (controlsContainer) {
        controlsContainer.style.display = (data.tailToggle !== 0) ? "flex" : "none";
      }

      // 同步永远指向形心开关
      const pointToggleInput = document.getElementById("slider-tailPointToAvatarCenter");
      if (pointToggleInput) {
        pointToggleInput.checked = (data.tailPointToAvatarCenter !== 0);
      }

      const colorProps = ["bubbleBorderColor", "bubbleBgColor", "textColor"];
      colorProps.forEach(cp => {
        const picker = document.getElementById(`picker-${cp}`);
        const input = document.getElementById(`input-${cp}`);
        if (picker && input) {
          picker.value = data[cp];
          input.value = data[cp];
        }
      });
    },

    syncPendantSlidersFromConfig: function() {
      const data = activeConfig[activePendantTab];
      document.getElementById("beautify-pendant-url").value = data.pendantUrl.startsWith("data:") ? "[本地上传挂件]" : data.pendantUrl;
      
      const props = ["pendantX", "pendantY", "pendantSize"];
      props.forEach(p => {
        const slider = document.getElementById(`slider-${p}`);
        const label = document.getElementById(`slider-val-${p}`);
        if (slider && label) {
          slider.value = data[p];
          label.innerText = `${data[p]}px`;
        }
      });
    },

    onSliderInput: function(prop, val) {
      const numVal = parseFloat(val);
      activeConfig[activeTab][prop] = numVal;

      const label = document.getElementById(`slider-val-${prop}`);
      if (label) {
        if (prop === "avatarRadius" || prop.startsWith("bubbleRadius") || prop === "tailY") {
          label.innerText = `${val}%`;
        } else if (prop.includes("Opacity")) {
          label.innerText = val;
        } else {
          label.innerText = `${val}px`;
        }
      }
      chatBeautifySystem.updatePreview(); 
    },

    onTailToggleInput: function(checked) {
      activeConfig[activeTab].tailToggle = checked ? 1 : 0;
      const controlsContainer = document.getElementById("beautify-tail-controls");
      if (controlsContainer) {
        controlsContainer.style.display = checked ? "flex" : "none";
      }
      chatBeautifySystem.updatePreview();
    },

    onTailPointToggleInput: function(checked) {
      activeConfig[activeTab].tailPointToAvatarCenter = checked ? 1 : 0;
      chatBeautifySystem.updatePreview();
    },

    onColorInput: function(prop, val) {
      activeConfig[activeTab][prop] = val;
      const picker = document.getElementById(`picker-${prop}`);
      const input = document.getElementById(`input-${prop}`);
      if (picker) picker.value = val;
      if (input) input.value = val;

      chatBeautifySystem.updatePreview();
    },

    onPendantSliderInput: function(prop, val) {
      const numVal = parseInt(val);
      activeConfig[activePendantTab][prop] = numVal;

      const label = document.getElementById(`slider-val-${prop}`);
      if (label) label.innerText = `${val}px`;
      chatBeautifySystem.updatePreview();
    },

    onPendantInput: function(prop, val) {
      activeConfig[activePendantTab][prop] = val;
      chatBeautifySystem.updatePreview();
    },

    clearPendant: function() {
      activeConfig[activePendantTab].pendantUrl = "";
      document.getElementById("beautify-pendant-url").value = "";
      chatBeautifySystem.updatePreview();
    },

    clearBackground: function() {
      activeConfig.bgUrl = "";
      document.getElementById("beautify-chat-bg-url").value = "";
      chatBeautifySystem.updatePreview();
    },

    makeSymmetry: function() {
      const current = activeConfig[activeTab];
      const targetTab = activeTab === "char" ? "user" : "char";
      
      const target = JSON.parse(JSON.stringify(current));
      
      // 镜像翻转气泡四角百分比圆角 [5]
      target.bubbleRadiusTL = current.bubbleRadiusTR;
      target.bubbleRadiusTR = current.bubbleRadiusTL;
      target.bubbleRadiusBL = current.bubbleRadiusBR;
      target.bubbleRadiusBR = current.bubbleRadiusBL;

      activeConfig[targetTab] = target;
      
      showToast(`已成功进行左右镜像对称同步。`);
      chatBeautifySystem.updatePreview();
    },

    // 预览沙盒与真实背景页即时无缝重绘引擎 [2]
    updatePreview: function() {
      const sandbox = document.getElementById("beautify-chat-sandbox");
      if (!sandbox) return;

      if (activeConfig.bgUrl) {
        sandbox.style.backgroundImage = `url(${activeConfig.bgUrl})`;
      } else {
        sandbox.style.backgroundImage = "none";
        sandbox.style.backgroundColor = "#ededed";
      }

      const avOther = document.getElementById("sandbox-avatar-other");
      const avSelf = document.getElementById("sandbox-avatar-self");

      if (avOther) {
        avOther.style.setProperty('width', `${activeConfig.char.avatarSize}px`, 'important');
        avOther.style.setProperty('height', `${activeConfig.char.avatarSize}px`, 'important');
        avOther.style.setProperty('border-radius', (activeConfig.char.avatarRadius / 2) + '%', 'important');
        
        const spacing = activeConfig.char.avatarSpacing !== undefined ? activeConfig.char.avatarSpacing : 10;
        avOther.style.setProperty('margin-right', `${spacing}px`, 'important');
      }
      if (avSelf) {
        avSelf.style.setProperty('width', `${activeConfig.user.avatarSize}px`, 'important');
        avSelf.style.setProperty('height', `${activeConfig.user.avatarSize}px`, 'important');
        avSelf.style.setProperty('border-radius', (activeConfig.user.avatarRadius / 2) + '%', 'important');
        
        const spacing = activeConfig.user.avatarSpacing !== undefined ? activeConfig.user.avatarSpacing : 10;
        avSelf.style.setProperty('margin-left', `${spacing}px`, 'important');
      }

      const txtOther = document.getElementById("sandbox-text-other");
      const txtSelf = document.getElementById("sandbox-text-self");

      if (txtOther) {
        const c = activeConfig.char;
        
        const rTL = (c.bubbleRadiusTL * 0.4) + "px";
        const rTR = (c.bubbleRadiusTR * 0.4) + "px";
        const rBL = (c.bubbleRadiusBL * 0.4) + "px";
        const rBR = (c.bubbleRadiusBR * 0.4) + "px";

        txtOther.style.setProperty('padding', `${c.bubblePaddingTB}px ${c.bubblePaddingLR}px`, 'important');
        txtOther.style.setProperty('border-top-left-radius', rTL, 'important');
        txtOther.style.setProperty('border-top-right-radius', rTR, 'important');
        txtOther.style.setProperty('border-bottom-left-radius', rBL, 'important');
        txtOther.style.setProperty('border-bottom-right-radius', rBR, 'important');
        txtOther.style.setProperty('border', `1px solid ${c.bubbleBorderColor}`, 'important');
        txtOther.style.setProperty('background-color', hexToRgba(c.bubbleBgColor, c.bubbleBgOpacity), 'important');
        txtOther.style.setProperty('color', c.textColor, 'important');
      }

      if (txtSelf) {
        const u = activeConfig.user;
        
        const rTL = (u.bubbleRadiusTL * 0.4) + "px";
        const rTR = (u.bubbleRadiusTR * 0.4) + "px";
        const rBL = (u.bubbleRadiusBL * 0.4) + "px";
        const rBR = (u.bubbleRadiusBR * 0.4) + "px";

        txtSelf.style.setProperty('padding', `${u.bubblePaddingTB}px ${u.bubblePaddingLR}px`, 'important');
        txtSelf.style.setProperty('border-top-left-radius', rTL, 'important');
        txtSelf.style.setProperty('border-top-right-radius', rTR, 'important');
        txtSelf.style.setProperty('border-bottom-left-radius', rBL, 'important');
        txtSelf.style.setProperty('border-bottom-right-radius', rBR, 'important');
        txtSelf.style.setProperty('border', `1px solid ${u.bubbleBorderColor}`, 'important');
        txtSelf.style.setProperty('background-color', hexToRgba(u.bubbleBgColor, u.bubbleBgOpacity), 'important');
        txtSelf.style.setProperty('color', u.textColor, 'important');
      }

      this.renderSandboxPendant("other", activeConfig.char);
      this.renderSandboxPendant("self", activeConfig.user);

      // 实时编译并在背景和沙盒双向应用 CSS [2, 3]
      let liveStyle = document.getElementById("chat-beautify-live-style");
      if (liveStyle) {
        liveStyle.textContent = this.compileConfigToCssString(activeConfig);
      }

      // 3. 实时沙盒小尾巴 CSS 渲染 (高精 Clip-Path 边框色填充，支持形心指向，完美去内部重合分割线) [1]
      const c = activeConfig.char;
      const u = activeConfig.user;

      let sandboxTailStyle = document.getElementById("chat-beautify-sandbox-tail-style");
      if (!sandboxTailStyle) {
        sandboxTailStyle = document.createElement("style");
        sandboxTailStyle.id = "chat-beautify-sandbox-tail-style";
        document.head.appendChild(sandboxTailStyle);
      }

      sandboxTailStyle.textContent = `
        #sandbox-text-other, #sandbox-text-self {
          position: relative !important;
        }
        
        /* 对方沙盒尖角：Clip-Path 边框色单片裁剪，无内部阻断分割线 */
        ${c.tailToggle !== 0 ? `
        #sandbox-text-other::after {
          content: "" !important;
          position: absolute !important;
          top: 0 !important;
          bottom: 0 !important;
          left: -${c.tailLength}px !important;
          width: ${c.tailLength}px !important;
          height: 100% !important;
          background-color: ${c.bubbleBorderColor} !important;
          pointer-events: none !important;
          z-index: 1 !important;
          clip-path: ${c.tailPointToAvatarCenter !== 0 ? `polygon(100% calc(${c.tailY}% - 4px), 100% calc(${c.tailY}% + 4px), 0% ${c.avatarSize / 2}px)` : `polygon(100% calc(${c.tailY}% - 4px), 100% calc(${c.tailY}% + 4px), 0% ${c.tailY}%)`} !important;
        }
        ` : '#sandbox-text-other::after { display: none !important; }'}

        /* 我方沙盒尖角 */
        ${u.tailToggle !== 0 ? `
        #sandbox-text-self::after {
          content: "" !important;
          position: absolute !important;
          top: 0 !important;
          bottom: 0 !important;
          right: -${u.tailLength}px !important;
          width: ${u.tailLength}px !important;
          height: 100% !important;
          background-color: ${u.bubbleBorderColor} !important;
          pointer-events: none !important;
          z-index: 1 !important;
          clip-path: ${u.tailPointToAvatarCenter !== 0 ? `polygon(0% calc(${u.tailY}% - 4px), 0% calc(${u.tailY}% + 4px), 100% ${u.avatarSize / 2}px)` : `polygon(0% calc(${u.tailY}% - 4px), 0% calc(${u.tailY}% + 4px), 100% ${u.tailY}%)`} !important;
        }
        ` : '#sandbox-text-self::after { display: none !important; }'}
      `;

      // 4. 实时沙盒手写 CSS 重新编译重映射预览 [3]
      let sandboxCustomStyle = document.getElementById("chat-beautify-sandbox-custom-style");
      if (!sandboxCustomStyle) {
        sandboxCustomStyle = document.createElement("style");
        sandboxCustomStyle.id = "chat-beautify-sandbox-custom-style";
        document.head.appendChild(sandboxCustomStyle);
      }
      // 先把消息容器选择器映射到沙盒，再用 scopeCss 整体隔离到沙盒，杜绝预览 CSS 溢出到真实页面
      let sandboxCss = (activeConfig.customCss || "").replace(/#dialog-messages-container/g, "#beautify-chat-sandbox");
      sandboxCss = scopeCss(sandboxCss, "#beautify-chat-sandbox");
      sandboxCustomStyle.textContent = sandboxCss;
    },

    // 针对沙盒挂件在轨重组，阻止叠加和拉伸 扁 故障 [6]
    renderSandboxPendant: function(side, data) {
      const bubbleEl = document.getElementById(`sandbox-bubble-${side}`);
      if (!bubbleEl) return;

      const wrapper = bubbleEl.querySelector(".sandbox-avatar-wrapper");
      if (!wrapper) return;

      let pendantEl = wrapper.querySelector(".sandbox-pendant-img");
      if (data.pendantUrl) {
        if (!pendantEl) {
          pendantEl = document.createElement("img");
          pendantEl.className = "sandbox-pendant-img";
          pendantEl.style.position = "absolute";
          pendantEl.style.pointerEvents = "none";
          pendantEl.style.zIndex = "5";
          
          pendantEl.style.maxWidth = "none";
          pendantEl.style.maxHeight = "none";
          pendantEl.style.objectFit = "contain";
          
          wrapper.appendChild(pendantEl);
        }
        pendantEl.src = data.pendantUrl;
        pendantEl.style.width = `${data.pendantSize}px`;
        pendantEl.style.height = `${data.pendantSize}px`;
        pendantEl.style.top = `${data.pendantY}px`;
        
        if (side === "other") {
          pendantEl.style.left = `${data.pendantX}px`;
          pendantEl.style.right = "auto";
        } else {
          pendantEl.style.right = `${data.pendantX}px`;
          pendantEl.style.left = "auto";
        }
        pendantEl.style.display = "block";
      } else {
        if (pendantEl) pendantEl.style.display = "none";
      }
    },

    // 复制按钮：一键复制聊天页的系统默认/初始全维度 CSS 属性表 (不随着 sliders 改变，完美还原初始干净蓝图) [1]
    copyGeneratedCss: function() {
      const cssString = chatBeautifySystem.compileFullThemeCssForClipboard();
      navigator.clipboard.writeText(cssString).then(() => {
        showToast("聊天页系统初始 CSS 样式蓝图已复制！您可将其发送给 AI 重塑风格。");
      }).catch(err => {
        console.error(err);
        showToast("浏览器权限阻断，请手动选择复制。");
      });
    },

    // 运行时临时美化注入 (纯净隔离，排除任何静态 btn-icon/win-header 影响，保护粉色状态心形按钮和灰字撤回)
    compileConfigToCssString: function(config) {
      const c = config.char;
      const u = config.user;

      const cSpacing = c.avatarSpacing !== undefined ? c.avatarSpacing : 10;
      const uSpacing = u.avatarSpacing !== undefined ? u.avatarSpacing : 10;

      // 气泡圆角等轴自适应物理像素折算
      const cR_TL = (c.bubbleRadiusTL * 0.4) + "px";
      const cR_TR = (c.bubbleRadiusTR * 0.4) + "px";
      const cR_BL = (c.bubbleRadiusBL * 0.4) + "px";
      const cR_BR = (c.bubbleRadiusBR * 0.4) + "px";

      const uR_TL = (u.bubbleRadiusTL * 0.4) + "px";
      const uR_TR = (u.bubbleRadiusTR * 0.4) + "px";
      const uR_BL = (u.bubbleRadiusBL * 0.4) + "px";
      const uR_BR = (u.bubbleRadiusBR * 0.4) + "px";

      return `/* 运行时临时美化注入 (纯净作用域隔离，不包含任何基础页头样式) */
#dialog-messages-container {
  ${config.bgUrl ? `background-image: url(${config.bgUrl}) !important;` : 'background-image: none !important; background-color: #ededed !important;'}
  background-size: cover !important;
  background-position: center !important;
}

/* 锁定消息窗口作用域，防止气泡挂件溢出 */
#dialog-messages-container .msg-bubble {
  position: relative !important;
}

/* 对方 (Char) 头像、间距、圆角与挂件控制 (通过 #dialog-messages-container 精准隔离，阻止挂件在沙盒上产生重影) */
#dialog-messages-container .msg-bubble.other .msg-avatar {
  width: ${c.avatarSize}px !important;
  height: ${c.avatarSize}px !important;
  border-radius: ${c.avatarRadius / 2}% !important;
  margin-right: ${cSpacing}px !important;
}
#dialog-messages-container .msg-bubble.other .msg-text {
  padding: ${c.bubblePaddingTB}px ${c.bubblePaddingLR}px !important;
  border-top-left-radius: ${cR_TL} !important;
  border-top-right-radius: ${cR_TR} !important;
  border-bottom-left-radius: ${cR_BL} !important;
  border-bottom-right-radius: ${cR_BR} !important;
  border: 1px solid ${c.bubbleBorderColor} !important;
  background-color: ${hexToRgba(c.bubbleBgColor, c.bubbleBgOpacity)} !important;
  color: ${c.textColor} !important;
}
${c.pendantUrl ? `#dialog-messages-container .msg-bubble.other::before {
  content: "" !important;
  position: absolute !important;
  top: ${c.pendantY}px !important;
  left: ${c.pendantX}px !important;
  width: ${c.pendantSize}px !important;
  height: ${c.pendantSize}px !important;
  background-image: url(${c.pendantUrl}) !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
  pointer-events: none !important;
  z-index: 5 !important;
}` : ''}

/* 对方小尾巴：高精 Clip-Path 边框色单片裁剪，无内部阻断分割线 [1] */
${c.tailToggle !== 0 ? `
#dialog-messages-container .msg-bubble.other .msg-text {
  position: relative !important;
}
#dialog-messages-container .msg-bubble.other .msg-text::after {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  left: -${c.tailLength}px !important;
  width: ${c.tailLength}px !important;
  height: 100% !important;
  background-color: ${c.bubbleBorderColor} !important;
  pointer-events: none !important;
  z-index: 1 !important;
  clip-path: ${c.tailPointToAvatarCenter !== 0 ? `polygon(100% calc(${c.tailY}% - 4px), 100% calc(${c.tailY}% + 4px), 0% ${c.avatarSize / 2}px)` : `polygon(100% calc(${c.tailY}% - 4px), 100% calc(${c.tailY}% + 4px), 0% ${c.tailY}%)`} !important;
}
` : ''}

/* 我方 (User) 头像、间距、圆角与挂件控制 */
#dialog-messages-container .msg-bubble.self .msg-avatar {
  width: ${u.avatarSize}px !important;
  height: ${u.avatarSize}px !important;
  border-radius: ${u.avatarRadius / 2}% !important;
  margin-left: ${uSpacing}px !important;
}
#dialog-messages-container .msg-bubble.self .msg-text {
  padding: ${u.bubblePaddingTB}px ${u.bubblePaddingLR}px !important;
  border-top-left-radius: ${uR_TL} !important;
  border-top-right-radius: ${uR_TR} !important;
  border-bottom-left-radius: ${uR_BL} !important;
  border-bottom-right-radius: ${uR_BR} !important;
  border: 1px solid ${u.bubbleBorderColor} !important;
  background-color: ${hexToRgba(u.bubbleBgColor, u.bubbleBgOpacity)} !important;
  color: ${u.textColor} !important;
}
${u.pendantUrl ? `#dialog-messages-container .msg-bubble.self::before {
  content: "" !important;
  position: absolute !important;
  top: ${u.pendantY}px !important;
  right: ${u.pendantX}px !important;
  width: ${u.pendantSize}px !important;
  height: ${u.pendantSize}px !important;
  background-image: url(${u.pendantUrl}) !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
  pointer-events: none !important;
  z-index: 5 !important;
}` : ''}

/* 我方小尾巴：高精 Clip-Path 边框色单片裁剪，无内部阻断分割线 [1] */
${u.tailToggle !== 0 ? `
#dialog-messages-container .msg-bubble.self .msg-text {
  position: relative !important;
}
#dialog-messages-container .msg-bubble.self .msg-text::after {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  right: -${u.tailLength}px !important;
  width: ${u.tailLength}px !important;
  height: 100% !important;
  background-color: ${u.bubbleBorderColor} !important;
  pointer-events: none !important;
  z-index: 1 !important;
  clip-path: ${u.tailPointToAvatarCenter !== 0 ? `polygon(0% calc(${u.tailY}% - 4px), 0% calc(${u.tailY}% + 4px), 100% ${u.avatarSize / 2}px)` : `polygon(0% calc(${u.tailY}% - 4px), 0% calc(${u.tailY}% + 4px), 100% ${u.tailY}%)`} !important;
}
` : ''}

/* 用户自定义 CSS (已通过 scopeCss 前缀器整体隔离到 #chat-dialog-panel，阻断对页头/输入框/其它面板/其它对话的越权溢出) */
${scopeCss(config.customCss || "", "#chat-dialog-panel")}`;
    },

    // 微信初始/原生页面最齐全的静态 CSS 属性映射结构蓝图 (不随滑块改变，提供给大模型完美无损调配) [1]
    compileFullThemeCssForClipboard: function() {
      return `/* ==========================================================================
   叙事诗小手机 - 微信聊天页面全维度初始默认 CSS 属性表（静态系统预设蓝图模板）
   ========================================================================== */

/* 1. 聊天窗口主背景与滚动容器 */
#dialog-messages-container {
  background-image: none !important; 
  background-color: #ededed !important;
  padding: 16px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 14px !important;
}

/* 2. 聊天窗口系统页头标题栏 */
#chat-dialog-panel .win-header {
  height: 56px !important;
  background-color: #ffffff !important;
  border-bottom: 1px solid #e2e8f0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 0 16px !important;
  position: relative !important;
}
#chat-dialog-panel .win-header h3 {
  font-size: 16px !important;
  color: #1e293b !important;
  font-weight: 700 !important;
  position: absolute !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  pointer-events: none !important;
}

/* 页头控制按钮 */
#chat-dialog-panel .btn-icon {
  background: none !important;
  border: none !important;
  width: 38px !important;
  height: 38px !important;
  border-radius: 50% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important; /* 修正：AI 勿在此处使用 space-between 或 padding 0 16px，这会严重压扁内部 SVG */
  color: #64748b !important;
  padding: 0 !important;
  cursor: pointer !important;
  transition: background-color 0.2s !important;
}
#chat-dialog-panel .btn-icon:hover {
  background-color: #f1f5f9 !important;
  color: #1e88e5 !important;
}

/* 3. 气泡与头像基础空间网格 */
.msg-bubble {
  display: flex !important;
  align-items: flex-start !important;
  max-width: 85% !important;
  position: relative !important;
}
.msg-bubble.self {
  align-self: flex-end !important;
  flex-direction: row-reverse !important;
}
.msg-bubble.other {
  align-self: flex-start !important;
}

/* 对方 (Char) 头像及气泡个性化定制 */
#dialog-messages-container .msg-bubble.other .msg-avatar {
  width: 40px !important;
  height: 40px !important;
  border-radius: 6px !important;
  margin-right: 10px !important;
}
#dialog-messages-container .msg-bubble.other .msg-text {
  padding: 10px 14px !important;
  border-top-left-radius: 6px !important;
  border-top-right-radius: 6px !important;
  border-bottom-left-radius: 6px !important;
  border-bottom-right-radius: 6px !important;
  border: 1px solid #e2e8f0 !important;
  background-color: #ffffff !important;
  color: #191919 !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  word-break: break-all !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
}

/* 我方 (User) 头像及气泡个性化定制 */
#dialog-messages-container .msg-bubble.self .msg-avatar {
  width: 40px !important;
  height: 40px !important;
  border-radius: 6px !important;
  margin-left: 10px !important;
}
#dialog-messages-container .msg-bubble.self .msg-text {
  padding: 10px 14px !important;
  border-top-left-radius: 6px !important;
  border-top-right-radius: 6px !important;
  border-bottom-left-radius: 6px !important;
  border-bottom-right-radius: 6px !important;
  border: 1px solid #e2e8f0 !important;
  background-color: #95ec69 !important;
  color: #191919 !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  word-break: break-all !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
}

/* 4. 底端微信输入控制栏及按钮 */
.dialog-input-container {
  background-color: #f7f7f7 !important;
  border-top: 1px solid #e2e8f0 !important;
  padding: 8px 12px !important;
  display: flex !important;
  flex-direction: column !important;
}
.input-main-row {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}
.dialog-input-container textarea {
  flex: 1 !important;
  border-radius: 8px !important;
  padding: 8px 10px !important;
  border: none !important;
  background-color: #ffffff !important;
  resize: none !important;
  font-size: 14px !important;
  max-height: 80px !important;
  outline: none !important;
}
.chat-send-btn {
  width: 38px !important;
  height: 38px !important;
  border-radius: 50% !important;
  border: none !important;
  background-color: #07c160 !important;
  color: white !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  transition: background-color 0.2s, transform 0.1s !important;
  flex-shrink: 0 !important;
}
.chat-send-btn.reply {
  background-color: #1e88e5 !important;
}

/* 5. 微信专属多媒体消息及特殊卡片 */
/* 微信语音卡片 */
.voice-bubble-card {
  background-color: #ffffff !important;
  padding: 10px 14px !important;
  border-radius: 6px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  cursor: pointer !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
  min-width: 70px !important;
  gap: 12px !important;
}
.msg-bubble.self .voice-bubble-card {
  background-color: #95ec69 !important;
  flex-direction: row-reverse !important;
}
.voice-bubble-wave {
  display: flex !important;
  align-items: center ! animate;
}
.voice-bubble-duration {
  font-size: 13px !important;
  color: #7f7f7f !important;
  font-weight: 600 !important;
}
.voice-translation-text {
  background: #ffffff !important;
  border: 1px solid #e2e8f0 !important;
  border-radius: 8px !important;
  padding: 10px 12px !important;
  margin-top: 6px !important;
  font-size: 13px !important;
  color: #1e293b !important;
  width: 100% !important;
  max-width: 220px !important;
  word-break: break-all !important;
}

/* 微信画面说明卡片 */
.msg-image-placeholder-card {
  background-color: #f3f4f6 !important;
  padding: 12px 14px !important;
  border-radius: 6px !important;
  cursor: pointer !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
  width: 220px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
  border: 1px solid #e2e8f0 !important;
}
.msg-bubble.self .msg-image-placeholder-card {
  background-color: #95ec69 !important;
}
.msg-image-placeholder-header {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}
.msg-image-placeholder-title {
  font-size: 13px !important;
  font-weight: 700 !important;
  color: #191919 !important;
}
.msg-image-placeholder-sub {
  font-size: 11px !important;
  color: #7f7f7f !important;
}
.image-description-text {
  background: #ffffff !important;
  border: 1.5px dashed #e2e8f0 !important;
  border-radius: 6px !important;
  padding: 10px !important;
  font-size: 12px !important;
  color: #191919 !important;
  line-height: 1.5 !important;
}

/* 微信橙黄转账与红包卡片 */
.wallet-bubble-card {
  width: 220px !important;
  border-radius: 8px !important;
  background-color: #fcfefe !important;
  border: 1px solid #e2e8f0 !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
  overflow: hidden !important;
  cursor: pointer !important;
}
.wallet-bubble-card.red-envelope {
  background-color: #fa9d3b !important;
  border: 1px solid #e4811a !important;
}
.wallet-bubble-card.red-envelope .wallet-bubble-title {
  color: #ffffff !important;
}
.wallet-bubble-card.red-envelope .wallet-bubble-desc {
  color: rgba(255, 255, 255, 0.8) !important;
}
.wallet-bubble-card.red-envelope .wallet-bubble-footer {
  background-color: #f9a44a !important;
  color: #ffffff !important;
  border-top: 1px solid #e4811a !important;
}
.wallet-bubble-card.transfer {
  background-color: #fa9d3b !important;
  border: 1px solid #e4811a !important;
}
.wallet-bubble-card.transfer.received {
  background-color: #f1ede8 !important;
  border: 1px solid #dcd7d2 !important;
}
.wallet-bubble-card.transfer.received .wallet-bubble-title,
.wallet-bubble-card.transfer.received .wallet-bubble-amount {
  color: #7f7f7f !important;
}
.wallet-bubble-card.transfer.received .wallet-bubble-footer {
  background-color: #faf9f7 !important;
  color: #7f7f7f !important;
  border-top: 1px solid #dcd7d2 !important;
}

/* 微信置中系统提示、撤回与时间分割线 */
.chat-time-divider, .group-system-notice-container, .recalled-system-msg-container {
  text-align: center !important;
  margin: 12px 0 !important;
  font-size: 11.5px !important;
  color: #b2b2b2 !important;
  width: 100% !important;
}
.recalled-system-msg-container div {
  background-color: rgba(0,0,0,0.05) !important;
  padding: 6px 12px !important;
  border-radius: 4px !important;
  display: inline-block !important;
}

/* 6. 群聊特殊高级卡片 */
/* 置顶群公告条 */
.group-announcement-sticky-bar {
  background: rgba(255, 255, 255, 0.85) !important;
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
  border-bottom: 1.5px solid #e2e8f0 !important;
  padding: 8px 16px !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
}
/* 微信群投票卡 */
.group-poll-card {
  background: #ffffff !important;
  border: 1.5px solid #e2e8f0 !important;
  border-radius: 12px !important;
  padding: 12px !important;
  width: 220px !important;
}
.group-poll-option-row {
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
  padding: 8px !important;
  background: #f8fafc !important;
  border-radius: 8px !important;
  margin-top: 6px !important;
}
.group-poll-progressbar {
  height: 6px !important;
  background: #e2e8f0 !important;
  border-radius: 3px !important;
}
`;
    },

    loadActiveConfig: async function(sessionId) {
      let liveStyle = document.getElementById("chat-beautify-live-style");
      if (!liveStyle) {
        liveStyle = document.createElement("style");
        liveStyle.id = "chat-beautify-live-style";
        document.head.appendChild(liveStyle);
      }

      const sess = await db.sessions.get(sessionId);
      if (sess && sess.beautifyConfig) {
        try {
          const config = JSON.parse(sess.beautifyConfig);
          liveStyle.textContent = this.compileConfigToCssString(config);
        } catch(e) {
          liveStyle.textContent = "";
        }
      } else {
        liveStyle.textContent = "";
      }
    },

    loadPresetsDropdown: function() {
      const select = document.getElementById("beautify-preset-select");
      if (!select) return;
      
      let presets = {};
      try {
        presets = JSON.parse(localStorage.getItem("chat-beautify-presets")) || {};
      } catch(e) {}

      select.innerHTML = '<option value="">-- 自定义预设库 --</option>';
      Object.keys(presets).forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.innerText = name;
        select.appendChild(opt);
      });
    },

    savePreset: function() {
      const name = prompt("请输入此美化方案预设名称:");
      if (!name) return;

      let presets = {};
      try {
        presets = JSON.parse(localStorage.getItem("chat-beautify-presets")) || {};
      } catch(e) {}

      presets[name] = activeConfig;
      localStorage.setItem("chat-beautify-presets", JSON.stringify(presets));
      
      showToast(`美化预设「${name}」已保存成功！`);
      chatBeautifySystem.loadPresetsDropdown();
      document.getElementById("beautify-preset-select").value = name;
    },

    deletePreset: function() {
      const select = document.getElementById("beautify-preset-select");
      const name = select.value;
      if (!name) {
        showToast("请先在下拉列表中选中一个预设！");
        return;
      }

      if (confirm(`确认要删除美化预设「${name}」吗？`)) {
        let presets = {};
        try {
          presets = JSON.parse(localStorage.getItem("chat-beautify-presets")) || {};
        } catch(e) {}
        delete presets[name];
        localStorage.setItem("chat-beautify-presets", JSON.stringify(presets));
        
        showToast("预设已成功移出预设库");
        chatBeautifySystem.loadPresetsDropdown();
      }
    },

    onPresetChange: function(name) {
      if (!name) return;
      let presets = {};
      try {
        presets = JSON.parse(localStorage.getItem("chat-beautify-presets")) || {};
      } catch(e) {}

      if (presets[name]) {
        activeConfig = JSON.parse(JSON.stringify(presets[name]));
        
        document.getElementById("beautify-chat-bg-url").value = activeConfig.bgUrl.startsWith("data:") ? "[本地上传背景]" : activeConfig.bgUrl;
        document.getElementById("beautify-custom-css-editor").value = activeConfig.customCss || "";

        chatBeautifySystem.syncSlidersFromConfig();
        chatBeautifySystem.syncPendantSlidersFromConfig();
        chatBeautifySystem.updatePreview();
        showToast(`已成功载入预设「${name}」！`);
      }
    },

    // 一键还原清空：物理擦除美化配置并立即重绘对话窗口
    resetAllStyles: async function() {
      if (!activeSessionId) return;
      if (confirm("确定要彻底清空此会话里的所有个性化美化样式，恢复微信原生默认样式吗？")) {
        await db.sessions.update(activeSessionId, { beautifyConfig: null });
        
        let liveStyle = document.getElementById("chat-beautify-live-style");
        if (liveStyle) liveStyle.textContent = "";

        let sandboxCustomStyle = document.getElementById("chat-beautify-sandbox-custom-style");
        if (sandboxCustomStyle) sandboxCustomStyle.textContent = "";

        activeConfig = JSON.parse(JSON.stringify(defaultConfig));
        
        document.getElementById("beautify-chat-bg-url").value = "";
        document.getElementById("beautify-custom-css-editor").value = "";

        chatBeautifySystem.syncSlidersFromConfig();
        chatBeautifySystem.syncPendantSlidersFromConfig();
        chatBeautifySystem.updatePreview();
        
        showToast("该会话的美化样式已全部清空恢复。");
        chatBeautifySystem.closePanel();

        if (typeof renderDialogMessages === 'function') {
          await renderDialogMessages();
        }
      }
    },

    applyActiveConfig: async function() {
      if (!activeSessionId) return;

      activeConfig.bgUrl = document.getElementById("beautify-chat-bg-url").value.trim() === "[本地上传背景]" ? activeConfig.bgUrl : document.getElementById("beautify-chat-bg-url").value.trim();
      activeConfig.customCss = document.getElementById("beautify-custom-css-editor").value.trim();

      await db.sessions.update(activeSessionId, {
        beautifyConfig: JSON.stringify(activeConfig)
      });

      chatBeautifySystem.loadActiveConfig(activeSessionId);
      
      showToast("美化样式已在此对话专属应用，窗口重绘完成！");
      chatBeautifySystem.closePanel();
      
      if (typeof renderDialogMessages === 'function') {
        await renderDialogMessages();
      }
    },

    bindUploadEvents: function() {
      const fileBg = document.getElementById("file-beautify-chat-bg");
      if (fileBg) {
        fileBg.onchange = async (e) => {
          if (e.target.files.length > 0) {
            const file = e.target.files[0];
            showToast("正在执行聊天背景自适应压缩...");

            // 核心：在轨压缩聊天背景，将体积从 5MB 压至 150KB 级别，彻底消除 7MB 样式表引起的浏览器样式重构线程死锁 [2]
            const compressedDataURL = await new Promise((resolve) => {
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
                resolve(canvas.toDataURL("image/jpeg", 0.75));
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

            activeConfig.bgUrl = compressedDataURL;
            document.getElementById("beautify-chat-bg-url").value = "[本地上传背景]";
            chatBeautifySystem.updatePreview();
          }
        };
      }

      const filePendant = document.getElementById("file-beautify-pendant");
      if (filePendant) {
        filePendant.onchange = (e) => {
          if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
              activeConfig[activePendantTab].pendantUrl = evt.target.result;
              document.getElementById("beautify-pendant-url").value = "[本地上传挂件]";
              chatBeautifySystem.updatePreview();
            };
            reader.readAsDataURL(file);
          }
        };
      }
    }
  };

  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * CSS 作用域隔离前缀器：把任意 CSS 文本中每条普通规则的选择器统一加上 scope 前缀，
   * 彻底阻断用户自定义 CSS 对页头/输入框/全局面板的越权溢出。
   * - @media / @supports / @container / @layer 递归进入内部继续前缀；
   * - @keyframes / @font-face / @page 等保持原样（其内部用百分比/标识符而非普通选择器）；
   * - @import / @charset 等无块语句保持原样。
   * 已带 scope 前缀的选择器不会被二次叠加，避免特异性膨胀。
   */
  function scopeCss(cssText, scope) {
    if (!cssText || !cssText.trim()) return "";
    const src = cssText.replace(/\/\*[\s\S]*?\*\//g, ""); // 剥离注释简化解析
    const n = src.length;
    let out = "";
    let i = 0;

    function prefixSelectorList(selList) {
      return selList.split(",").map(function(sel) {
        const s = sel.trim();
        if (!s) return sel;
        if (s === scope || s.indexOf(scope + " ") === 0 || s.indexOf(scope + ".") === 0 ||
            s.indexOf(scope + "#") === 0 || s.indexOf(scope + ":") === 0 ||
            s.indexOf(scope + ">") === 0 || s.indexOf(scope + "+") === 0 ||
            s.indexOf(scope + "~") === 0) {
          return s; // 已在作用域内，避免重复前缀
        }
        return scope + " " + s;
      }).join(",");
    }

    function findClose(openIdx) {
      let depth = 1;
      let j = openIdx + 1;
      while (j < n && depth > 0) {
        const ch = src[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      return j - 1;
    }

    while (i < n) {
      let j = i;
      while (j < n && src[j] !== ";" && src[j] !== "{") j++;
      if (j >= n) { out += src.slice(i); break; }
      if (src[j] === ";") {
        out += src.slice(i, j + 1); // 无块语句（@import 等）原样保留
        i = j + 1;
      } else {
        const prelude = src.slice(i, j);
        const closeIdx = findClose(j);
        const body = src.slice(j + 1, closeIdx);
        const trimmed = prelude.trim();
        if (trimmed.charAt(0) === "@") {
          const m = trimmed.match(/^@([a-zA-Z-]+)/);
          const name = m ? m[1].toLowerCase() : "";
          if (name === "media" || name === "supports" || name === "container" || name === "layer") {
            out += prelude + "{" + scopeCss(body, scope) + "}";
          } else {
            out += prelude + "{" + body + "}"; // @keyframes / @font-face 等原样
          }
        } else {
          out += prefixSelectorList(prelude) + "{" + body + "}";
        }
        i = closeIdx + 1;
      }
    }
    return out;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      chatBeautifySystem.bindUploadEvents();
    });
  } else {
    chatBeautifySystem.bindUploadEvents();
  }

  window.chatBeautifySystem = chatBeautifySystem;
})();