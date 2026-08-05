/**
 * app_chat_cot.js - 思维链 (Chain of Thought / CoT) 控制中枢与动态步骤编排器
 * 
 * 功能简述：
 * 1. 管理会话级别的思维链开关 (cotToggle) 与步骤配置 (cotOnlineSteps / cotOfflineSteps)。
 * 2. 提供全局预设库 CRUD (IndexedDB: cot_presets)。
 * 3. 步骤卡片支持动态添加、编辑、启用/禁用开关、以及【上移/下移】排序。
 * 4. 编译输出强约束的 System Prompt 思考协议，强制大模型在 <think>...</think> 中按步骤思考。
 * 5. 遵从去 Emoji 规则，所有控制图标均采用 Feather/Lucide 矢量 SVG。
 */

(function() {
  const cotSystem = {
    activeModeTab: 'online', // 'online' 或 'offline'
    currentPresetId: null,

    // 自定义提示词临时缓存
    activePromptTab: 'online',
    currentPromptPresetId: null,
    customOnlinePromptText: "",
    customOfflinePromptText: "",

    // 内存中维护的临时步骤与正则队列
    onlineSteps: [],
    offlineSteps: [],
    customRegexRules: [],

    // 内置不可更改的思维链自动补全与归一化正则
    builtinCotRule: {
      id: 'builtin_cot',
      name: '思维链标签归一化与补全 (内置不可更改)',
      pattern: '(?:<think>|\\[THINKING\\]|【思考】|<thought>|<thinking>)([\\s\\S]*?)(?:<\\/think>|\\[\\/THINKING\\]|【\\/思考】|<\\/thought>|<\\/thinking>|(?=\\n\\n[【\\[\\w])|$)',
      flags: 'i',
      isBuiltin: true
    },

    // 默认初始示例步骤
    defaultOnlineSteps: [
      { id: 'step_1', title: '用户心理与情绪探查', desc: '冷静分析用户上一句台词中的真实情绪倾向、潜台词或社交意图。', enabled: true },
      { id: 'step_2', title: '角色立场与动机盘算', desc: '结合自身人设与当前利益/情感关系，决定自己此时此刻的态度与立场。', enabled: true },
      { id: 'step_3', title: '话术风格与口癖锁定', desc: '确定即将输出的回复语气，挑选合乎性格特征的词汇与句式。', enabled: true }
    ],

    defaultOfflineSteps: [
      { id: 'step_off_1', title: '环境氛围与微表情捕捉', desc: '观察当前物理场景氛围、天气与对方的肢体小动作。', enabled: true },
      { id: 'step_off_2', title: '动作叙事逻辑推演', desc: '推演角色接下来的肢体举止与神态语言，严禁越权替用户做决定。', enabled: true }
    ],

    // 1. 打开思维链面板
    openPanel: async function() {
      if (!activeSessionId) {
        showToast("请先进入一个好友聊天或群聊对话！");
        return;
      }
      const panel = document.getElementById("chat-cot-panel");
      if (panel) {
        panel.classList.add("active");
        await this.loadSessionConfig();
        await this.loadPresetsDropdown();
        this.renderStepsList();
      }
    },

    // 2. 关闭思维链面板
    closePanel: function() {
      const panel = document.getElementById("chat-cot-panel");
      if (panel) panel.classList.remove("active");
    },

    // 3. 加载当前 Session 的思维链与自定义提示词配置
    loadSessionConfig: async function() {
      const sess = await db.sessions.get(activeSessionId);
      if (!sess) return;

      const toggleEl = document.getElementById("cot-session-toggle");
      if (toggleEl) toggleEl.checked = sess.cotToggle === 1;

      this.currentPresetId = sess.cotPresetId || null;

      this.onlineSteps = (sess.cotOnlineSteps && sess.cotOnlineSteps.length > 0)
        ? JSON.parse(JSON.stringify(sess.cotOnlineSteps))
        : JSON.parse(JSON.stringify(this.defaultOnlineSteps));

      this.offlineSteps = (sess.cotOfflineSteps && sess.cotOfflineSteps.length > 0)
        ? JSON.parse(JSON.stringify(sess.cotOfflineSteps))
        : JSON.parse(JSON.stringify(this.defaultOfflineSteps));

      this.customRegexRules = (sess.cotRegexRules && Array.isArray(sess.cotRegexRules))
        ? JSON.parse(JSON.stringify(sess.cotRegexRules))
        : [];

      // 提取当前 Session 绑定的提示词文本与预设 ID
      this.currentPromptPresetId = sess.promptPresetId || null;
      this.customOnlinePromptText = sess.customOnlinePromptText || "";
      this.customOfflinePromptText = sess.customOfflinePromptText || "";
    },

    // 4. 保存配置到当前 Session
    saveSessionConfig: async function() {
      const toggleEl = document.getElementById("cot-session-toggle");
      const isEnabled = toggleEl ? toggleEl.checked : false;

      await db.sessions.update(activeSessionId, {
        cotToggle: isEnabled ? 1 : 0,
        cotPresetId: this.currentPresetId,
        cotOnlineSteps: this.onlineSteps,
        cotOfflineSteps: this.offlineSteps,
        cotRegexRules: this.customRegexRules,
        promptPresetId: this.currentPromptPresetId,
        customOnlinePromptText: this.customOnlinePromptText,
        customOfflinePromptText: this.customOfflinePromptText
      });

      showToast("思维链配置已成功保存！");
      this.closePanel();
    },

    // 打开自定义提示词管理专属面板
    openPromptManager: async function() {
      const panel = document.getElementById("chat-prompt-panel");
      if (!panel) return;

      await this.loadPromptPresetsDropdown();

      // 赋初值文本
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        textarea.value = (this.activePromptTab === 'online')
          ? this.customOnlinePromptText
          : this.customOfflinePromptText;
      }

      panel.classList.add("active");
    },

    // 关闭自定义提示词管理面板
    closePromptManager: function() {
      const panel = document.getElementById("chat-prompt-panel");
      if (panel) panel.classList.remove("active");
    },

    // 切换提示词模式选项卡 (线上 / 线下)
    switchPromptTab: function(mode) {
      // 保存当前文本框内容到内存
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        if (this.activePromptTab === 'online') {
          this.customOnlinePromptText = textarea.value;
        } else {
          this.customOfflinePromptText = textarea.value;
        }
      }

      this.activePromptTab = mode;
      const btnOnline = document.getElementById("prompt-tab-btn-online");
      const btnOffline = document.getElementById("prompt-tab-btn-offline");
      const titleEl = document.getElementById("prompt-editor-mode-title");

      if (mode === 'online') {
        if (btnOnline) { btnOnline.className = "btn"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOffline) { btnOffline.className = "btn btn-outline"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线上聊天提示词内容";
        if (textarea) textarea.value = this.customOnlinePromptText;
      } else {
        if (btnOffline) { btnOffline.className = "btn"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOnline) { btnOnline.className = "btn btn-outline"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线下剧场提示词内容";
        if (textarea) textarea.value = this.customOfflinePromptText;
      }
    },

    // 加载全局提示词预设下拉列表
    loadPromptPresetsDropdown: async function() {
      const select = document.getElementById("prompt-preset-select");
      if (!select) return;

      select.innerHTML = '<option value="">-- 系统默认提示词 (恢复默认) --</option>';
      if (typeof db !== 'undefined' && db.prompt_presets) {
        const presets = await db.prompt_presets.toArray();
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.innerText = p.name;
          if (this.currentPromptPresetId && Number(this.currentPromptPresetId) === p.id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      }
    },

    // 下拉选择提示词预设
    onPromptPresetChange: async function(presetIdVal) {
      if (!presetIdVal) {
        this.currentPromptPresetId = null;
        this.customOnlinePromptText = "";
        this.customOfflinePromptText = "";
        showToast("已重置为系统默认提示词模板");
      } else {
        const preset = await db.prompt_presets.get(Number(presetIdVal));
        if (preset) {
          this.currentPromptPresetId = preset.id;
          this.customOnlinePromptText = preset.onlinePrompt || "";
          this.customOfflinePromptText = preset.offlinePrompt || "";
          showToast(`已载入提示词预设 [${preset.name}]`);
        }
      }

      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        textarea.value = (this.activePromptTab === 'online')
          ? this.customOnlinePromptText
          : this.customOfflinePromptText;
      }
    },

    // 存为新提示词预设
    savePromptAsNewPreset: function() {
      // 先同步当前 textarea
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      showCustomPrompt("请输入提示词预设名称", "例如：极致病娇型、高冷克制型", async (name) => {
        if (!name || !name.trim()) return;
        const newPreset = {
          name: name.trim(),
          onlinePrompt: this.customOnlinePromptText,
          offlinePrompt: this.customOfflinePromptText
        };
        const newId = await db.prompt_presets.add(newPreset);
        this.currentPromptPresetId = newId;
        showToast(`提示词预设 [${name}] 已成功保存！`);
        await this.loadPromptPresetsDropdown();
      });
    },

    // 更新当前选中的提示词预设
    updateCurrentPromptPreset: async function() {
      if (!this.currentPromptPresetId) {
        showToast("请先在下拉框中选择要更新的预设！");
        return;
      }

      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      await db.prompt_presets.update(Number(this.currentPromptPresetId), {
        onlinePrompt: this.customOnlinePromptText,
        offlinePrompt: this.customOfflinePromptText
      });

      showToast("已成功更新当前提示词预设！");
    },

    // 删除当前提示词预设
    deletePromptPreset: async function() {
      if (!this.currentPromptPresetId) {
        showToast("请先在下拉框中选择要删除的预设！");
        return;
      }

      showCustomConfirm("确认删除", "确定要删除该提示词预设吗？", async () => {
        await db.prompt_presets.delete(Number(this.currentPromptPresetId));
        this.currentPromptPresetId = null;
        this.customOnlinePromptText = "";
        this.customOfflinePromptText = "";
        showToast("预设已彻底删除，已重置为默认");
        await this.loadPromptPresetsDropdown();
        
        const textarea = document.getElementById("prompt-editor-textarea");
        if (textarea) textarea.value = "";
      });
    },

    // 重置当前模式提示词文本
    resetCurrentPromptText: function() {
      if (this.activePromptTab === 'online') {
        this.customOnlinePromptText = "";
      } else {
        this.customOfflinePromptText = "";
      }
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) textarea.value = "";
      showToast("已清空当前模式提示词，保存后将恢复系统默认");
    },

    // 保存并应用提示词到当前对话 Session
    savePromptToSession: async function() {
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      await db.sessions.update(activeSessionId, {
        promptPresetId: this.currentPromptPresetId,
        customOnlinePromptText: this.customOnlinePromptText,
        customOfflinePromptText: this.customOfflinePromptText
      });

      showToast("自定义提示词已成功应用到本对话！");
      this.closePromptManager();
    },

    // 加载并渲染当前对话绑定的线上/线下提示词下拉菜单
    loadPromptSelects: async function(sess) {
      const onlineSelect = document.getElementById("cot-online-prompt-select");
      const offlineSelect = document.getElementById("cot-offline-prompt-select");
      if (!onlineSelect || !offlineSelect) return;

      onlineSelect.innerHTML = '<option value="">-- 系统默认线上提示词 --</option>';
      offlineSelect.innerHTML = '<option value="">-- 系统默认线下提示词 --</option>';

      if (typeof db !== 'undefined' && db.prompt_presets) {
        const presets = await db.prompt_presets.toArray();
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.innerText = p.name;

          if (p.type === 'online') {
            if (sess && Number(sess.onlinePromptId) === p.id) opt.selected = true;
            onlineSelect.appendChild(opt);
          } else {
            if (sess && Number(sess.offlinePromptId) === p.id) opt.selected = true;
            offlineSelect.appendChild(opt);
          }
        });
      }
    },

    // 切换线上提示词绑定
    onOnlinePromptChange: function(val) {
      showToast(val ? "已选择线上自定义提示词" : "已恢复系统默认线上提示词");
    },

    // 切换线下提示词绑定
    onOfflinePromptChange: function(val) {
      showToast(val ? "已选择线下自定义提示词" : "已恢复系统默认线下提示词");
    },

    // 打开自定义提示词管理专属面板 (直接平滑切入页面，彻底保护线下提示词不被重写)
    openPromptManager: async function() {
      const panel = document.getElementById("chat-prompt-panel");
      if (!panel) return;

      const sess = await db.sessions.get(activeSessionId);
      if (sess) {
        this.currentPromptPresetId = sess.promptPresetId || null;
        this.customOnlinePromptText = sess.customOnlinePromptText || "";
        this.customOfflinePromptText = sess.customOfflinePromptText || "";

        // 若本对话关联了预设且自定义文本为空，自动拉取预设文本兜底回显
        if (this.currentPromptPresetId && (!this.customOnlinePromptText || !this.customOfflinePromptText) && typeof db !== 'undefined' && db.prompt_presets) {
          try {
            const preset = await db.prompt_presets.get(Number(this.currentPromptPresetId));
            if (preset) {
              if (!this.customOnlinePromptText) this.customOnlinePromptText = preset.onlinePrompt || "";
              if (!this.customOfflinePromptText) this.customOfflinePromptText = preset.offlinePrompt || "";
            }
          } catch(e) {}
        }
      }

      await this.loadPromptPresetsDropdown();

      // 填充标题
      const nameInput = document.getElementById("prompt-preset-name-input");
      if (nameInput) {
        if (this.currentPromptPresetId) {
          const p = await db.prompt_presets.get(Number(this.currentPromptPresetId));
          nameInput.value = p ? p.name : "";
        } else {
          nameInput.value = "";
        }
      }

      // 纯净挂载：默认锁定为线上模式，直接写值，绝不触发切签重写逻辑
      this.activePromptTab = 'online';
      const btnOnline = document.getElementById("prompt-tab-btn-online");
      const btnOffline = document.getElementById("prompt-tab-btn-offline");
      const titleEl = document.getElementById("prompt-editor-mode-title");
      const textarea = document.getElementById("prompt-editor-textarea");

      if (btnOnline) { btnOnline.className = "btn"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
      if (btnOffline) { btnOffline.className = "btn btn-outline"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
      if (titleEl) titleEl.innerText = "线上聊天提示词内容";
      if (textarea) textarea.value = this.customOnlinePromptText || "";

      panel.classList.add("active");
    },

    // 关闭自定义提示词管理面板
    closePromptManager: function() {
      const panel = document.getElementById("chat-prompt-panel");
      if (panel) panel.classList.remove("active");
    },

    // 切换提示词模式选项卡 (线上 / 线下)
    switchPromptTab: function(mode) {
      if (this.activePromptTab === mode) return;

      const textarea = document.getElementById("prompt-editor-textarea");
      
      // 仅在手动点击切换 Tab 时，才将文本框现有内容同步保存回对应的变量中
      if (textarea) {
        if (this.activePromptTab === 'online') {
          this.customOnlinePromptText = textarea.value;
        } else if (this.activePromptTab === 'offline') {
          this.customOfflinePromptText = textarea.value;
        }
      }

      this.activePromptTab = mode;
      const btnOnline = document.getElementById("prompt-tab-btn-online");
      const btnOffline = document.getElementById("prompt-tab-btn-offline");
      const titleEl = document.getElementById("prompt-editor-mode-title");

      if (mode === 'online') {
        if (btnOnline) { btnOnline.className = "btn"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOffline) { btnOffline.className = "btn btn-outline"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线上聊天提示词内容";
        if (textarea) textarea.value = this.customOnlinePromptText || "";
      } else {
        if (btnOffline) { btnOffline.className = "btn"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOnline) { btnOnline.className = "btn btn-outline"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线下剧场提示词内容";
        if (textarea) textarea.value = this.customOfflinePromptText || "";
      }
    },

    // 加载全局提示词预设下拉列表
    loadPromptPresetsDropdown: async function() {
      const select = document.getElementById("prompt-preset-select");
      if (!select) return;

      select.innerHTML = '<option value="">-- 系统默认提示词 (未绑定预设) --</option>';
      if (typeof db !== 'undefined' && db.prompt_presets) {
        const presets = await db.prompt_presets.toArray();
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.innerText = p.name;
          if (this.currentPromptPresetId && Number(this.currentPromptPresetId) === p.id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      }
    },

    // 下拉选择提示词预设
    onPromptPresetChange: async function(presetIdVal) {
      const nameInput = document.getElementById("prompt-preset-name-input");
      const textarea = document.getElementById("prompt-editor-textarea");

      if (!presetIdVal) {
        this.currentPromptPresetId = null;
        this.customOnlinePromptText = "";
        this.customOfflinePromptText = "";
        if (nameInput) nameInput.value = "";
        if (textarea) textarea.value = "";
        showToast("已重置为系统默认提示词");
      } else {
        const preset = await db.prompt_presets.get(Number(presetIdVal));
        if (preset) {
          this.currentPromptPresetId = preset.id;
          this.customOnlinePromptText = preset.onlinePrompt || "";
          this.customOfflinePromptText = preset.offlinePrompt || "";
          if (nameInput) nameInput.value = preset.name || "";
          if (textarea) {
            textarea.value = (this.activePromptTab === 'online') ? this.customOnlinePromptText : this.customOfflinePromptText;
          }
          showToast(`已载入提示词预设 [${preset.name}]`);
        }
      }
    },

    // 打包存为新提示词预设 (包含标题 + 线上提示词 + 线下提示词)
    savePromptAsNewPreset: async function() {
      const nameInput = document.getElementById("prompt-preset-name-input");
      const textarea = document.getElementById("prompt-editor-textarea");

      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      const presetName = nameInput ? nameInput.value.trim() : "";
      if (!presetName) {
        showToast("请先在上方输入提示词预设标题！");
        return;
      }

      const newPreset = {
        name: presetName,
        onlinePrompt: this.customOnlinePromptText,
        offlinePrompt: this.customOfflinePromptText
      };

      const newId = await db.prompt_presets.add(newPreset);
      this.currentPromptPresetId = newId;
      showToast(`提示词预设包 [${presetName}] 保存成功！`);
      await this.loadPromptPresetsDropdown();
    },

    // 更新当前选中的提示词预设
    updateCurrentPromptPreset: async function() {
      if (!this.currentPromptPresetId) {
        showToast("请先在下拉框中选择要更新的预设！");
        return;
      }

      const nameInput = document.getElementById("prompt-preset-name-input");
      const textarea = document.getElementById("prompt-editor-textarea");

      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      const presetName = nameInput ? nameInput.value.trim() : "未命名预设";

      await db.prompt_presets.update(Number(this.currentPromptPresetId), {
        name: presetName,
        onlinePrompt: this.customOnlinePromptText,
        offlinePrompt: this.customOfflinePromptText
      });

      showToast(`已更新提示词预设 [${presetName}]！`);
      await this.loadPromptPresetsDropdown();
    },

    // 删除当前提示词预设
    deletePromptPreset: async function() {
      if (!this.currentPromptPresetId) {
        showToast("请先在下拉框中选择要删除的预设！");
        return;
      }

      showCustomConfirm("确认删除", "确定要彻底删除该提示词预设吗？", async () => {
        await db.prompt_presets.delete(Number(this.currentPromptPresetId));
        this.currentPromptPresetId = null;
        this.customOnlinePromptText = "";
        this.customOfflinePromptText = "";
        showToast("预设已彻底删除");
        await this.loadPromptPresetsDropdown();
        
        const nameInput = document.getElementById("prompt-preset-name-input");
        const textarea = document.getElementById("prompt-editor-textarea");
        if (nameInput) nameInput.value = "";
        if (textarea) textarea.value = "";
      });
    },

    // 重置当前模式提示词文本为默认
    resetCurrentPromptText: function() {
      if (this.activePromptTab === 'online') {
        this.customOnlinePromptText = "";
      } else {
        this.customOfflinePromptText = "";
      }
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) textarea.value = "";
      showToast("已清空当前模式提示词");
    },

    // 保存并应用提示词到当前对话 Session
    savePromptToSession: async function() {
      const textarea = document.getElementById("prompt-editor-textarea");
      if (textarea) {
        if (this.activePromptTab === 'online') this.customOnlinePromptText = textarea.value;
        else this.customOfflinePromptText = textarea.value;
      }

      await db.sessions.update(activeSessionId, {
        promptPresetId: this.currentPromptPresetId,
        customOnlinePromptText: this.customOnlinePromptText,
        customOfflinePromptText: this.customOfflinePromptText
      });

      showToast("自定义提示词已成功应用到本对话！");
      this.closePromptManager();
    },

    // 思维链与文本正则替换引擎 (纯粹解析文本中的思维链，历史消息永久保留)
    parseThoughtWithRegex: function(text) {
      if (!text) return { thought: "", cleanText: "" };
      let processedText = text;

      // 1. 预处理：使用内置正则对错漏、未闭合、异形思维链标签进行强行自动修补归一化
      try {
        const builtinReg = new RegExp(this.builtinCotRule.pattern, this.builtinCotRule.flags);
        if (builtinReg.test(processedText)) {
          processedText = processedText.replace(builtinReg, (fullMatch, p1) => {
            return `<think>\n${p1.trim()}\n</think>\n`;
          });
        }
      } catch(e) {
        console.error("内置思维链正则预处理异常:", e);
      }

      // 1.5 孤儿标签归一化：补全只有结束标签 / 只有开始标签的残缺思维链
      // 场景：大模型偶尔只输出 </think> 结束标签而漏掉 <think>，或反之。
      const endTags = ["</think>", "[/THINKING]", "【/思考】", "</thought>", "</thinking>"];
      const startTags = ["<think>", "[THINKING]", "【思考】", "<thought>", "<thinking>"];
      const hasAnyEnd = endTags.some(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(processedText));
      const hasAnyStart = startTags.some(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(processedText));
      if (hasAnyEnd && !hasAnyStart) {
        // 仅有结束标签：把首个结束标签之前的全部内容视作思维链，在开头补一个 <think>
        for (let k = 0; k < endTags.length; k++) {
          const escEnd = endTags[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const endIdx = processedText.search(new RegExp(escEnd, "i"));
          if (endIdx >= 0) {
            processedText = "<think>\n" + processedText.slice(0, endIdx).trim() + "\n" + endTags[k] + processedText.slice(endIdx + endTags[k].length);
            break;
          }
        }
      } else if (hasAnyStart && !hasAnyEnd) {
        // 仅有开始标签：在文本末尾补一个 </think>
        for (let k = 0; k < startTags.length; k++) {
          const escStart = startTags[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp(escStart, "i").test(processedText)) {
            processedText = processedText + "\n" + endTags[k];
            break;
          }
        }
      }

      // 2. 核心隔离：优先提炼并剥离 <think>...</think>，防止自定义正则误触思维链内容
      let thought = "";
      let cleanText = processedText;

      const standardThinkRegex = /<think>([\s\S]*?)<\/think>/i;
      const match = cleanText.match(standardThinkRegex);
      if (match) {
        thought = match[1].trim();
        cleanText = cleanText.replace(match[0], "").trim();
      }

      // 3. 自定义正则流水线【仅在对白正文 cleanText】上运行，实现物理级零冲突
      if (this.customRegexRules && this.customRegexRules.length > 0) {
        this.customRegexRules.forEach(rule => {
          if (!rule.enabled) return;
          try {
            const reg = new RegExp(rule.pattern, rule.flags || 'g');
            cleanText = cleanText.replace(reg, rule.replacement !== undefined ? rule.replacement : "");
          } catch(err) {
            console.warn("自定义正则规则执行失败:", err);
          }
        });
      }

      return { thought, cleanText };
    },

    // 添加自定义正则规则
    addCustomRegexRule: function() {
      showCustomPrompt("请输入正则规则名称", "例如：清理未闭合动作括号", (name) => {
        if (!name || !name.trim()) return;
        const newRule = {
          id: 'regex_' + Date.now(),
          name: name.trim(),
          pattern: '\\([（\\s]*动作[：:]\\s*([^\\)]+)[）\\)]',
          flags: 'gi',
          replacement: '$1',
          enabled: true
        };
        this.customRegexRules.push(newRule);
        this.renderStepsList();
      });
    },

    // 查看/编辑自定义正则 (包含 Pattern 查找正则与 Replacement 替换文本)
    editCustomRegexRule: function(idx) {
      const rule = this.customRegexRules[idx];
      if (!rule) return;
      showCustomPrompt(`编辑规则 [${rule.name}] 的查找正则 (Pattern)`, rule.pattern, (newPattern) => {
        if (newPattern === null || !newPattern.trim()) return;
        rule.pattern = newPattern.trim();
        showCustomPrompt(`编辑规则 [${rule.name}] 的替换文本 (Replacement，支持 $1 捕获组，留空则擦除)`, rule.replacement !== undefined ? rule.replacement : "", (newRepl) => {
          if (newRepl !== null) rule.replacement = newRepl;
          this.renderStepsList();
        });
      });
    },

    // 删除自定义正则
    deleteCustomRegexRule: function(idx) {
      this.customRegexRules.splice(idx, 1);
      this.renderStepsList();
    },

    // 5. 切换 Session 总开关
    toggleSessionCot: function(isChecked) {
      showToast(isChecked ? "本对话已开启思维链推演" : "本对话已关闭思维链推演");
    },

    // 6. 切换 线上 / 线下 模式 Tab
    switchModeTab: function(mode) {
      this.activeModeTab = mode;
      const btnOnline = document.getElementById("cot-tab-btn-online");
      const btnOffline = document.getElementById("cot-tab-btn-offline");
      const titleEl = document.getElementById("cot-mode-title");

      if (mode === 'online') {
        if (btnOnline) { btnOnline.className = "btn"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOffline) { btnOffline.className = "btn btn-outline"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线上聊天思考步骤";
      } else {
        if (btnOffline) { btnOffline.className = "btn"; btnOffline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px; background:var(--primary); color:#fff;"; }
        if (btnOnline) { btnOnline.className = "btn btn-outline"; btnOnline.style.cssText = "flex:1; height:36px; font-size:12px; font-weight:700; border-radius:10px;"; }
        if (titleEl) titleEl.innerText = "线下剧场思考步骤";
      }
      this.renderStepsList();
    },

    // 7. 渲染步骤列表
    renderStepsList: function() {
      const container = document.getElementById("cot-steps-list-container");
      if (!container) return;

      container.innerHTML = "";
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;

      if (steps.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:var(--text-secondary); font-size:12px; padding:20px 0;">当前暂无思考步骤，点击右上角添加。</div>`;
        return;
      }

      steps.forEach((st, idx) => {
        const card = document.createElement("div");
        card.style.cssText = "background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:6px;";

        const isFirst = idx === 0;
        const isLast = idx === steps.length - 1;

        card.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:6px; flex:1; overflow:hidden;">
              <span style="font-size:10px; font-weight:800; background:#e2e8f0; color:#475569; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${idx + 1}</span>
              <input type="text" value="${escapeHtml(st.title)}" onchange="cotSystem.updateStepTitle(${idx}, this.value)" style="font-size:12px; font-weight:700; border:1px solid var(--border); border-radius:6px; padding:2px 6px; flex:1; outline:none; background:#fff;">
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0; margin-left:6px;">
              <label class="switch" style="transform:scale(0.85);">
                <input type="checkbox" ${st.enabled ? 'checked' : ''} onchange="cotSystem.toggleStepEnable(${idx}, this.checked)">
                <span class="slider"></span>
              </label>
              <button class="btn btn-outline" onclick="cotSystem.moveStep(${idx}, -1)" ${isFirst ? 'disabled' : ''} style="padding:2px 6px; font-size:10px; border-radius:4px;" title="上移">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button class="btn btn-outline" onclick="cotSystem.moveStep(${idx}, 1)" ${isLast ? 'disabled' : ''} style="padding:2px 6px; font-size:10px; border-radius:4px;" title="下移">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <button class="btn btn-danger-outline" onclick="cotSystem.deleteStep(${idx})" style="padding:2px 6px; font-size:10px; border-radius:4px; color:#ef4444; border-color:#fca5a5;" title="删除">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <textarea onchange="cotSystem.updateStepDesc(${idx}, this.value)" rows="2" style="width:100%; font-size:11px; border:1px solid var(--border); border-radius:6px; padding:6px; resize:none; box-sizing:border-box; background:#fff; color:var(--text-primary);" placeholder="输入该步骤的具体思考要求...">${escapeHtml(st.desc)}</textarea>
        `;

        container.appendChild(card);
      });

      // 渲染正则配置板块
      const regexSection = document.createElement("div");
      regexSection.style.cssText = "margin-top:16px; border-top:1.5px dashed var(--border); padding-top:14px;";

      let customRulesHtml = "";
      if (this.customRegexRules && this.customRegexRules.length > 0) {
        customRulesHtml = this.customRegexRules.map((rule, rIdx) => `
          <div style="background:#fff; border:1px solid var(--border); border-radius:8px; padding:8px; margin-top:8px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:11px; font-weight:700; color:var(--text-primary);">${escapeHtml(rule.name)}</span>
              <div style="display:flex; align-items:center; gap:6px;">
                <label class="switch" style="transform:scale(0.8);">
                  <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="cotSystem.customRegexRules[${rIdx}].enabled = this.checked;">
                  <span class="slider"></span>
                </label>
                <button class="btn btn-outline" onclick="cotSystem.editCustomRegexRule(${rIdx})" style="padding:2px 6px; font-size:10px; border-radius:4px;">编辑</button>
                <button class="btn btn-danger-outline" onclick="cotSystem.deleteCustomRegexRule(${rIdx})" style="padding:2px 6px; font-size:10px; border-radius:4px; color:#ef4444; border-color:#fca5a5;">删除</button>
              </div>
            </div>
            <div style="font-family:monospace; font-size:10px; background:#f1f5f9; padding:6px; border-radius:6px; color:#334155; word-break:break-all; display:flex; flex-direction:column; gap:2px;">
              <div><span style="color:#64748b; font-weight:700;">查找:</span> /${escapeHtml(rule.pattern)}/${rule.flags || 'g'}</div>
              <div><span style="color:#64748b; font-weight:700;">替换:</span> "${escapeHtml(rule.replacement !== undefined ? rule.replacement : '')}"</div>
            </div>
          </div>
        `).join("");
      } else {
        customRulesHtml = `<div style="font-size:11px; color:var(--text-secondary); padding:8px 0; text-align:center;">暂无自定义正则脚本</div>`;
      }

      regexSection.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:12px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            正则管道 (Regex Scripts)
          </span>
          <button class="btn btn-outline" onclick="cotSystem.addCustomRegexRule()" style="padding:3px 8px; font-size:10px; border-radius:6px; font-weight:700;">+ 添加正则脚本</button>
        </div>

        <!-- 1. 内置自动修复正则卡片 -->
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:8px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size:11px; font-weight:700; color:#166534;">${this.builtinCotRule.name}</span>
            <span style="font-size:9px; background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:4px; font-weight:800;">内置自动补全</span>
          </div>
          <div style="font-family:monospace; font-size:10px; background:#ffffff; padding:6px; border-radius:6px; color:#15803d; border:1px solid #86efac; word-break:break-all;">
            <div><span style="font-weight:700;">查找:</span> /${this.builtinCotRule.pattern}/${this.builtinCotRule.flags}</div>
            <div><span style="font-weight:700;">动作:</span> 自动补全为 &lt;think&gt;$1&lt;/think&gt; 并归一化提取</div>
          </div>
        </div>

        <!-- 2. 自定义正则列表 -->
        <div>
          ${customRulesHtml}
        </div>
      `;

      container.appendChild(regexSection);
    },

    // 8. 添加新步骤
    addStep: function() {
      const newStep = {
        id: 'step_' + Date.now(),
        title: '新思考步骤',
        desc: '请在此处输入具体推演要求...',
        enabled: true
      };
      if (this.activeModeTab === 'online') {
        this.onlineSteps.push(newStep);
      } else {
        this.offlineSteps.push(newStep);
      }
      this.renderStepsList();
    },

    // 9. 更新步骤标题与描述
    updateStepTitle: function(idx, val) {
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;
      if (steps[idx]) steps[idx].title = val.trim();
    },
    updateStepDesc: function(idx, val) {
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;
      if (steps[idx]) steps[idx].desc = val.trim();
    },

    // 10. 切换步骤启用状态
    toggleStepEnable: function(idx, isChecked) {
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;
      if (steps[idx]) steps[idx].enabled = isChecked;
      this.renderStepsList();
    },

    // 11. 步骤移动排序 (dir: -1 上移, 1 下移)
    moveStep: function(idx, dir) {
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= steps.length) return;

      const temp = steps[idx];
      steps[idx] = steps[targetIdx];
      steps[targetIdx] = temp;
      this.renderStepsList();
    },

    // 12. 删除指定步骤
    deleteStep: function(idx) {
      const steps = this.activeModeTab === 'online' ? this.onlineSteps : this.offlineSteps;
      steps.splice(idx, 1);
      this.renderStepsList();
    },

    // 13. 加载全局预设下拉菜单
    loadPresetsDropdown: async function() {
      const select = document.getElementById("cot-preset-select");
      if (!select) return;

      select.innerHTML = '<option value="">-- 新建/自定义思维链 --</option>';
      const presets = await db.cot_presets.toArray();

      presets.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.innerText = p.name;
        if (this.currentPresetId && Number(this.currentPresetId) === p.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    },

    // 14. 切换预设 (同步载入线上/线下思维链与配套正则)
        onPresetChange: async function(presetIdVal) {
          if (!presetIdVal) {
            this.currentPresetId = null;
            return;
          }
          const preset = await db.cot_presets.get(Number(presetIdVal));
          if (preset) {
            this.currentPresetId = preset.id;
            this.onlineSteps = JSON.parse(JSON.stringify(preset.onlineSteps || this.defaultOnlineSteps));
            this.offlineSteps = JSON.parse(JSON.stringify(preset.offlineSteps || this.defaultOfflineSteps));
            this.customRegexRules = JSON.parse(JSON.stringify(preset.regexRules || preset.cotRegexRules || []));
            showToast(`已载入包含配套正则的预设 [${preset.name}]`);
            this.renderStepsList();
          }
        },

        // 15. 将当前线上线下思维链及配套正则打包保存为新预设
        saveCurrentAsPreset: function() {
          showCustomPrompt("请输入新思维链预设的名称", "例如：深谋远虑型、傲娇反差型", async (name) => {
            if (!name || !name.trim()) return;
            const newPreset = {
              name: name.trim(),
              onlineSteps: this.onlineSteps,
              offlineSteps: this.offlineSteps,
              regexRules: this.customRegexRules
            };
            const newId = await db.cot_presets.add(newPreset);
            this.currentPresetId = newId;
            showToast(`包含配套正则的预设 [${name}] 已成功保存！`);
            await this.loadPresetsDropdown();
          });
        },

        // 16. 导出当前预设包 (.json)
        exportPreset: async function() {
          let presetName = "思维链与正则预设";
          if (this.currentPresetId) {
            const p = await db.cot_presets.get(Number(this.currentPresetId));
            if (p && p.name) presetName = p.name;
          }

          const exportObj = {
            type: "story_phone_cot_preset",
            version: 1,
            name: presetName,
            onlineSteps: this.onlineSteps,
            offlineSteps: this.offlineSteps,
            regexRules: this.customRegexRules
          };

          const jsonStr = JSON.stringify(exportObj, null, 2);
          const fileName = `${presetName}_${Date.now()}.json`;

          if (window.AndroidMCP && typeof window.AndroidMCP.saveBackupFile === 'function') {
            const ok = window.AndroidMCP.saveBackupFile(jsonStr, fileName);
            if (ok) {
              showToast(`预设成功导出至手机：/Download/Storypoem/${fileName}`);
              return;
            }
          }

          const blob = new Blob([jsonStr], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast(`预设包 [${presetName}] 导出成功！`);
        },

        // 17. 导入预设包 (.json)
        importPreset: function(inputEl) {
          const file = inputEl.files ? inputEl.files[0] : null;
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = JSON.parse(e.target.result);
              if (!data.onlineSteps && !data.offlineSteps && !data.regexRules && !data.cotRegexRules) {
                throw new Error("无效的预设包格式，未包含思维链步骤或正则规则节点");
              }

              const presetName = data.name || file.name.replace(/\.json$/i, '');
              const newPreset = {
                name: presetName,
                onlineSteps: data.onlineSteps || this.defaultOnlineSteps,
                offlineSteps: data.offlineSteps || this.defaultOfflineSteps,
                regexRules: data.regexRules || data.cotRegexRules || []
              };

              const newId = await db.cot_presets.add(newPreset);
              this.currentPresetId = newId;
              this.onlineSteps = JSON.parse(JSON.stringify(newPreset.onlineSteps));
              this.offlineSteps = JSON.parse(JSON.stringify(newPreset.offlineSteps));
              this.customRegexRules = JSON.parse(JSON.stringify(newPreset.regexRules));

              showToast(`预设 [${presetName}] 导入成功！包含 ${this.customRegexRules.length} 条配套正则`);
              await this.loadPresetsDropdown();
              this.renderStepsList();

            } catch (err) {
              console.error("导入预设失败:", err);
              showCustomAlert("导入预设失败", err.message);
            } finally {
              inputEl.value = "";
            }
          };
          reader.readAsText(file);
        },

    // 16. 删除当前预设
    deletePreset: async function() {
      if (!this.currentPresetId) {
        showToast("请先在下拉框中选择要删除的预设！");
        return;
      }
      showCustomConfirm("确认删除", "确定要彻底删除该思维链预设吗？", async () => {
        await db.cot_presets.delete(Number(this.currentPresetId));
        this.currentPresetId = null;
        showToast("预设已彻底删除");
        await this.loadPresetsDropdown();
      });
    },

    // 17. 编译思维链提示词段落 (注入至 System Prompt 头部/尾部)
        buildCotPromptSegment: async function(sessionId, mode = 'online') {
          const sess = await db.sessions.get(sessionId);
          if (!sess || sess.cotToggle !== 1) return "";

          // TODO (待以后优化解决): 群聊场景下由于多角色 (Multi-Char) 频繁发言与思维链容易冲突卡顿，
          // 暂时在群聊模式下屏蔽思维链提示词注入，待后续版本重构多角色思维链队列后再重新开放。
          if (sess.isGroup === 1) return "";

          const steps = (mode === 'online' ? sess.cotOnlineSteps : sess.cotOfflineSteps) || [];
          const activeSteps = steps.filter(s => s.enabled);

          if (activeSteps.length === 0) return "";

          let promptText = "【思维链 (Chain of Thought / CoT) 深度心理推演协议】\n";
          promptText += "【强制要求】：你在给出正式对白/文字回复前，【必须且只能】在最开头输出包裹在 `<think>...</think>` 标签内的思考过程！\n";
          promptText += "你在 `<think>` 内部思考时，必须严格按照以下步骤依次进行内心情感与逻辑推演：\n\n";

          activeSteps.forEach((st, idx) => {
            promptText += `步骤 ${idx + 1}【${st.title}】：${st.desc}\n`;
          });

          promptText += "\n【输出格式规范与发信要求】：\n";
          promptText += "<think>\n";
          activeSteps.forEach((st, idx) => {
            promptText += `步骤 ${idx + 1} (${st.title}): ...思考内容...\n`;
          });
          promptText += "</think>\n";
          promptText += "第一句短消息...\n第二句短消息...\n（思考结束后，请像真实人类发微信一样，换行输出 1~3 条短消息连发！绝对不要把思考过程漏到对白里！）";

          return promptText;
        }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }

  function bindCotTrigger() {
    const btn = document.getElementById("btn-chat-cot");
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        const expandPanel = document.getElementById("chat-expand-panel");
        if (expandPanel) expandPanel.classList.remove("active");
        cotSystem.openPanel();
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindCotTrigger);
  } else {
    bindCotTrigger();
  }

  window.cotSystem = cotSystem;
})();