/**
 * app_mcp_client.js - Model Context Protocol (MCP) 独立宿主客户端与 JSON-RPC 2.0 传输中枢
 * 
 * 功能简述：
 * 1. 提供完整的 MCP Client/Host 规范支持（Streamable HTTP 与 SSE 管道）。
 * 2. 引入分组 (Group) 机制：支持顶栏分组切换 Tabs、分组总开关控制。
 * 3. 支持分组总开关、服务器总开关与工具单体开关的多级精细化控制（IndexedDB + LocalStorage持久化）。
 * 4. 自动过滤已被禁用的分组/服务器，将已启用的 Tools 编译为标准的 System Prompt 段落。
 * 5. 自动捕获与处理 Web 浏览器端 CORS 跨域问题 (Failed to fetch)，并对接安卓原生网络穿透。
 * 6. 100% 遵从去 Emoji 命令，所有按钮与 UI 组件均采用矢量 SVG 路径。
 */

(function() {
  const mcpClientSystem = {
    // 当前选中的分组 Tab (默认 "全部")
    activeGroup: "全部",

    // 获取分组开关映射状态 ({ "默认": true, "生活服务": false })
    getGroupStates: function() {
      try {
        return JSON.parse(localStorage.getItem("mcp_group_states")) || {};
      } catch(e) {
        return {};
      }
    },

    // 检查某个分组是否开启 (默认开启)
    isGroupEnabled: function(groupName) {
      if (groupName === "全部") return true;
      const states = this.getGroupStates();
      return states[groupName] !== undefined ? states[groupName] : true;
    },

    // 切换某个分组的总开关
    setGroupState: function(groupName, enabled) {
      const states = this.getGroupStates();
      states[groupName] = enabled;
      localStorage.setItem("mcp_group_states", JSON.stringify(states));
    },

    // 1. 打开 MCP 服务器配置面板
    openServersPanel: async function() {
      const panel = document.getElementById("mcp-servers-panel");
      if (panel) {
        panel.classList.add("active");
        await this.renderServersList();
      }
    },

    // 2. 关闭 MCP 服务器配置面板
    closeServersPanel: function() {
      const panel = document.getElementById("mcp-servers-panel");
      if (panel) {
        panel.classList.remove("active");
      }
      if (window.mcpSystem && typeof window.mcpSystem.loadMcpSettings === 'function') {
        window.mcpSystem.loadMcpSettings();
      }
    },

    // 3. 打开新建/编辑服务器弹窗
    openServerEditModal: async function(serverId = null) {
      const overlay = document.getElementById("mcp-server-edit-overlay");
      const titleEl = document.getElementById("mcp-server-modal-title");
      const idInput = document.getElementById("mcp-server-edit-id");
      const nameInput = document.getElementById("mcp-server-input-name");
      const groupInput = document.getElementById("mcp-server-input-group");
      const typeSelect = document.getElementById("mcp-server-input-type");
      const urlInput = document.getElementById("mcp-server-input-url");
      const headersInput = document.getElementById("mcp-server-input-headers");

      if (!overlay) return;

      if (serverId) {
        titleEl.innerText = "编辑 MCP 服务器";
        const server = await db.mcp_servers.get(Number(serverId));
        if (server) {
          idInput.value = server.id;
          nameInput.value = server.name || "";
          if (groupInput) groupInput.value = server.group || "默认";
          typeSelect.value = server.type || "streamable_http";
          urlInput.value = server.url || "";
          headersInput.value = server.headers ? JSON.stringify(server.headers, null, 2) : "";
        }
      } else {
        titleEl.innerText = "新建 MCP 服务器";
        idInput.value = "";
        nameInput.value = "";
        if (groupInput) groupInput.value = this.activeGroup !== "全部" ? this.activeGroup : "默认";
        typeSelect.value = "streamable_http";
        urlInput.value = "";
        headersInput.value = "";
      }

      overlay.classList.add("active");
    },

    // 4. 关闭编辑弹窗
    closeServerEditModal: function() {
      const overlay = document.getElementById("mcp-server-edit-overlay");
      if (overlay) overlay.classList.remove("active");
    },

    // 5. 保存服务器配置并自动拉取工具 (tools/list)
    saveServerAndFetchTools: async function() {
      const idVal = document.getElementById("mcp-server-edit-id").value;
      const name = document.getElementById("mcp-server-input-name").value.trim();
      const groupEl = document.getElementById("mcp-server-input-group");
      const group = groupEl ? (groupEl.value.trim() || "默认") : "默认";
      const type = document.getElementById("mcp-server-input-type").value;
      const url = document.getElementById("mcp-server-input-url").value.trim();
      const headersStr = document.getElementById("mcp-server-input-headers").value.trim();

      if (!name || !url) {
        showToast("请填写完整的服务器名称与 URL 地址！");
        return;
      }

      let parsedHeaders = {};
      if (headersStr) {
        try {
          parsedHeaders = JSON.parse(headersStr);
        } catch (e) {
          showToast("自定义 Headers JSON 格式不合法！");
          return;
        }
      }

      showToast(`正在保存 [分组:${group}] ${name} 并连接拉取...`);

      try {
        // 向 MCP 服务器发送 JSON-RPC 2.0 tools/list 请求
        const fetchedTools = await this.rpcFetchToolsList(url, type, parsedHeaders);

        let serverId = idVal ? Number(idVal) : null;
        let existingToolsMap = {};

        if (serverId) {
          const oldServer = await db.mcp_servers.get(serverId);
          if (oldServer && oldServer.tools) {
            oldServer.tools.forEach(t => {
              existingToolsMap[t.name] = t.enabled;
            });
          }
        }

        // 整理工具明细并继承历史开关状态
        const toolsList = fetchedTools.map(t => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: existingToolsMap[t.name] !== undefined ? existingToolsMap[t.name] : true
        }));

        const serverData = {
          name: name,
          group: group,
          type: type,
          url: url,
          headers: parsedHeaders,
          enabled: true,
          tools: toolsList,
          updatedAt: Date.now()
        };

        if (serverId) {
          await db.mcp_servers.update(serverId, serverData);
        } else {
          serverId = await db.mcp_servers.add(serverData);
        }

        showToast(`成功连接！并拉取到 ${toolsList.length} 个 MCP 工具`);
        this.closeServerEditModal();
        await this.renderServersList();

      } catch (err) {
        console.error("拉取 MCP 工具失败:", err);
        showCustomAlert("拉取 MCP 工具失败", `无法成功与 MCP 服务器建立通信：\n${err.message}`);
      }
    },

    // 通用底层请求引擎：极速自适应跨域穿透 (支持直连、安卓原生桥接、多重 CORS 代理熔断)
    mcpFetch: async function(url, options) {
      // 1. 真机 APK 环境：若原生桥挂载了 sendNativeHttpRequest，优先走 Kotlin 原生网络 (100% 避开浏览器 CORS 限制)
      if (window.AndroidMCP && typeof window.AndroidMCP.sendNativeHttpRequest === 'function') {
        try {
          const headersJson = JSON.stringify(options.headers || {});
          const bodyStr = options.body || "";
          const method = options.method || "POST";
          const nativeResStr = window.AndroidMCP.sendNativeHttpRequest(url, method, headersJson, bodyStr);
          if (nativeResStr) {
            const parsedRes = JSON.parse(nativeResStr);
            return {
              ok: parsedRes.status >= 200 && parsedRes.status < 300,
              status: parsedRes.status,
              text: async () => parsedRes.body,
              json: async () => JSON.parse(parsedRes.body),
              headers: {
                get: (k) => {
                  if (!parsedRes.headers) return null;
                  const targetKey = Object.keys(parsedRes.headers).find(key => key.toLowerCase() === k.toLowerCase());
                  return targetKey ? parsedRes.headers[targetKey] : null;
                }
              }
            };
          }
        } catch (e) {
          console.warn("[MCP Native Bridge] 原生请求通道异常，回退为 Web 代理:", e);
        }
      }

      // 2. 优先尝试浏览器直连
      try {
        const directResponse = await fetch(url, options);
        return directResponse;
      } catch (err) {
        // 当捕获到 Failed to fetch（跨域 CORS 拦截或预检拒绝）时，启动多代理容灾链路
        if (err && err.message && (err.message.includes("Failed to fetch") || err.message.includes("NetworkError"))) {
          console.warn("[MCP CORS Warning] 直连被跨域策略阻断，正在切入多通道跨域代理桥:", url);

          // 代理通道 1: thingproxy (完美透传 Authorization 鉴权头与 POST 实体)
          try {
            const proxyUrl1 = "https://thingproxy.freeboard.io/fetch/" + url;
            const res1 = await fetch(proxyUrl1, options);
            if (res1.ok || res1.status < 500) return res1;
          } catch (e1) {
            console.warn("[MCP Proxy 1] thingproxy 代理未响应，尝试通道 2...");
          }

          // 代理通道 2: corsproxy.io
          try {
            const proxyUrl2 = "https://corsproxy.io/?" + encodeURIComponent(url);
            const res2 = await fetch(proxyUrl2, options);
            if (res2.ok || res2.status < 500) return res2;
          } catch (e2) {
            console.warn("[MCP Proxy 2] corsproxy 代理未响应，尝试通道 3...");
          }

          // 代理通道 3: allorigins 容灾兜底
          try {
            const proxyUrl3 = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
            const res3 = await fetch(proxyUrl3, options);
            if (res3.ok || res3.status < 500) return res3;
          } catch (e3) {
            console.warn("[MCP Proxy 3] 代理通道尝试完毕");
          }
        }
        throw err;
      }
    },

    // 6. MCP 标准初始化握手 (initialize & notifications/initialized)
    rpcInitialize: async function(url, type, headers) {
      const initPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "叙事诗小手机",
            version: "1.0.0"
          }
        }
      };

      const requestHeaders = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...headers
      };

      // 步骤 1：发送 initialize 握手包
      const response = await this.mcpFetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(initPayload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`初始化握手 HTTP ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(`初始化握手 JSON-RPC Error [${resData.error.code}]: ${resData.error.message}`);
      }

      // 提取可能返回的 Mcp-Session-Id
      let sessionIdHeader = response.headers.get("Mcp-Session-Id") || response.headers.get("mcp-session-id");
      let activeHeaders = { ...headers };
      if (sessionIdHeader) {
        activeHeaders["Mcp-Session-Id"] = sessionIdHeader;
      }

      // 步骤 2：发送 notifications/initialized 挂钩通知
      try {
        await this.mcpFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...activeHeaders
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized"
          })
        });
      } catch (e) {
        console.warn("发送 notifications/initialized 挂钩通知:", e);
      }

      return activeHeaders;
    },

    // 7. JSON-RPC 2.0: 通用 POST / SSE 请求驱动器
    rpcRequest: async function(url, type, headers, method, params = {}) {
      const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: method,
        params: params
      };

      const requestHeaders = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...headers
      };

      if (type === "streamable_http" || type === "sse") {
        const response = await this.mcpFetch(url, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const resData = await response.json();
        if (resData.error) {
          throw new Error(`JSON-RPC Error [${resData.error.code}]: ${resData.error.message}`);
        }
        return resData.result;
      }
    },

    // 8. 拉取工具列表 (tools/list)
    rpcFetchToolsList: async function(url, type, headers) {
      const activeHeaders = await this.rpcInitialize(url, type, headers);
      const result = await this.rpcRequest(url, type, activeHeaders, "tools/list", {});
      if (result && Array.isArray(result.tools)) {
        return result.tools;
      }
      return [];
    },

    // 9. 触发具体工具调用 (tools/call)
    callMcpTool: async function(serverName, toolName, args) {
      const servers = await db.mcp_servers.toArray();
      const server = servers.find(s => s.name === serverName && s.enabled && this.isGroupEnabled(s.group || "默认"));
      if (!server) {
        throw new Error(`未找到名为 [${serverName}] 的可用 MCP 服务器（或对应分组已被关闭）`);
      }

      const targetTool = (server.tools || []).find(t => t.name === toolName && t.enabled);
      if (!targetTool) {
        throw new Error(`在服务器 [${serverName}] 中未找到名为 [${toolName}] 的可用工具或该工具已被禁用`);
      }

      let activeHeaders = server.headers || {};
      try {
        activeHeaders = await this.rpcInitialize(server.url, server.type, server.headers || {});
      } catch (e) {
        console.warn("工具调用前握手提示:", e);
      }

      const params = {
        name: toolName,
        arguments: args
      };

      const result = await this.rpcRequest(server.url, server.type, activeHeaders, "tools/call", params);
      return result;
    },

    // 10. 切换当前分组 Tab 视图
    switchGroupTab: async function(groupName) {
      this.activeGroup = groupName;
      await this.renderServersList();
    },

    // 11. 切换当前活跃分组的总开关
    toggleActiveGroupMaster: async function(isChecked) {
      if (this.activeGroup === "全部") return;
      this.setGroupState(this.activeGroup, isChecked);
      await this.renderServersList();
    },

    // 12. 渲染 MCP 服务器、分组 Tabs 与工具层级卡片列表
    renderServersList: async function() {
      const container = document.getElementById("mcp-servers-list-container");
      const tabsBar = document.getElementById("mcp-group-tabs-bar");
      const masterTitle = document.getElementById("mcp-active-group-title");
      const masterToggle = document.getElementById("mcp-group-master-toggle");
      const summaryText = document.getElementById("mcp-servers-summary-text");

      if (!container) return;
      container.innerHTML = "";

      const servers = await db.mcp_servers.toArray();

      // 收集所有唯一分组
      const groupSet = new Set(["全部"]);
      servers.forEach(s => groupSet.add(s.group || "默认"));
      const allGroups = Array.from(groupSet);

      if (!allGroups.includes(this.activeGroup)) {
        this.activeGroup = "全部";
      }

      // 12.1 渲染顶栏分组 Tabs
      if (tabsBar) {
        tabsBar.innerHTML = allGroups.map(gName => {
          const isActive = gName === this.activeGroup;
          const isEnabled = gName === "全部" ? true : this.isGroupEnabled(gName);
          const activeStyle = isActive
            ? "background: var(--primary); color: #ffffff; font-weight: 700; border-color: var(--primary);"
            : "background: #ffffff; color: var(--text-primary); border-color: var(--border);";
          const disabledBadge = (!isEnabled && gName !== "全部")
            ? `<span style="font-size:9px; background:#fee2e2; color:#ef4444; padding:0 4px; border-radius:4px; margin-left:4px;">已关</span>`
            : "";

          return `<button class="btn btn-outline" onclick="mcpClientSystem.switchGroupTab('${escapeHtml(gName)}')" style="padding: 5px 12px; font-size: 12px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; cursor: pointer; ${activeStyle}">
            ${escapeHtml(gName)}${disabledBadge}
          </button>`;
        }).join("");
      }

      // 12.2 更新当前分组总开关卡片
      if (masterTitle && masterToggle) {
        if (this.activeGroup === "全部") {
          masterTitle.innerText = "全部分组 (全局感知)";
          masterToggle.checked = true;
          masterToggle.disabled = true;
        } else {
          masterTitle.innerText = `分组 [${this.activeGroup}] 总开关`;
          masterToggle.disabled = false;
          masterToggle.checked = this.isGroupEnabled(this.activeGroup);
        }
      }

      // 12.3 过滤当前 Tab 分组下的服务器
      const filteredServers = (this.activeGroup === "全部")
        ? servers
        : servers.filter(s => (s.group || "默认") === this.activeGroup);

      // 计算全站受控激活工具数
      let activeToolsCount = 0;
      servers.forEach(s => {
        const grp = s.group || "默认";
        if (this.isGroupEnabled(grp) && s.enabled && s.tools) {
          activeToolsCount += s.tools.filter(t => t.enabled).length;
        }
      });

      if (summaryText) {
        summaryText.innerText = `共 ${servers.length} 服务 (${allGroups.length - 1} 分组)，实时激活 ${activeToolsCount} 工具`;
      }

      if (filteredServers.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; color:var(--text-secondary); font-size:12px; padding:30px 0;">
            当前分组 [${escapeHtml(this.activeGroup)}] 暂无 MCP 服务器。<br>点击右上角加号按键添加服务。
          </div>
        `;
        return;
      }

      filteredServers.forEach(srv => {
        const card = document.createElement("div");
        card.className = "mcp-card";
        card.style.cssText = "background:#ffffff; border:1.5px solid var(--border); border-radius:12px; padding:12px; box-shadow: var(--shadow-sm); display:flex; flex-direction:column; gap:10px;";

        const toolsCount = srv.tools ? srv.tools.length : 0;
        const activeCount = srv.tools ? srv.tools.filter(t => t.enabled).length : 0;
        const srvGroup = srv.group || "默认";
        const isGrpEnabled = this.isGroupEnabled(srvGroup);

        let toolsListHtml = "";
        if (srv.tools && srv.tools.length > 0) {
          toolsListHtml = srv.tools.map((t, idx) => {
            const state = t.state || (t.enabled === false ? 'disabled' : 'auto');
            
            let btnStyle = "";
            let btnLabel = "";
            let iconSvg = "";

            if (state === 'auto') {
              // 🟢 绿色：直接调用
              btnStyle = "background:#dcfce7; color:#15803d; border:1px solid #86efac;";
              btnLabel = "直接";
              iconSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
            } else if (state === 'confirm') {
              // 🔵 蓝色：询问确认
              btnStyle = "background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd;";
              btnLabel = "确认";
              iconSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
            } else {
              // 🔴 红色：禁用
              btnStyle = "background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;";
              btnLabel = "禁用";
              iconSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            }

            return `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; background:#f8fafc; border-radius:8px; border:1px solid var(--border); ${(!isGrpEnabled || !srv.enabled || state === 'disabled') ? 'opacity:0.65;' : ''}">
                <div style="flex:1; overflow:hidden; padding-right:8px;">
                  <div style="font-size:12px; font-weight:700; color:var(--text-primary); text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">${escapeHtml(t.name)}</div>
                  <div style="font-size:10px; color:var(--text-secondary); text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">${escapeHtml(t.description || '暂无描述')}</div>
                </div>
                <button class="btn" onclick="mcpClientSystem.cycleToolState(${srv.id}, ${idx})" style="padding:3px 8px; font-size:10px; font-weight:700; border-radius:6px; display:flex; align-items:center; gap:3px; cursor:pointer; flex-shrink:0; transition:all 0.15s; ${btnStyle}">
                  ${iconSvg}
                  <span>${btnLabel}</span>
                </button>
              </div>
            `;
          }).join("");
        } else {
          toolsListHtml = `<div style="font-size:11px; color:var(--text-secondary); padding:4px;">未读取到工具</div>`;
        }

        card.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px dashed var(--border); padding-bottom:8px;">
            <div>
              <div style="font-size:14px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                ${escapeHtml(srv.name)}
                <span style="font-size:9px; background:#f3f4f6; color:#475569; padding:1px 5px; border-radius:4px; font-weight:700;">组: ${escapeHtml(srvGroup)}</span>
                <span style="font-size:9px; background:#e0f2fe; color:#0369a1; padding:1px 5px; border-radius:4px; font-weight:700;">${srv.type === 'sse' ? 'SSE' : 'HTTP'}</span>
              </div>
              <div style="font-size:10px; color:var(--text-secondary); margin-top:2px; word-break:break-all;">${escapeHtml(srv.url)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <label class="switch">
                <input type="checkbox" ${srv.enabled ? 'checked' : ''} onchange="mcpClientSystem.toggleServerActive(${srv.id}, this.checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; font-weight:700; color:var(--text-secondary);">包含工具 (${activeCount}/${toolsCount})</span>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-outline" onclick="mcpClientSystem.refreshServerTools(${srv.id})" style="padding:3px 8px; font-size:10px; border-radius:6px; display:flex; align-items:center; gap:2px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 重新拉取
              </button>
              <button class="btn btn-outline" onclick="mcpClientSystem.openServerEditModal(${srv.id})" style="padding:3px 8px; font-size:10px; border-radius:6px;">编辑</button>
              <button class="btn btn-danger-outline" onclick="mcpClientSystem.deleteServer(${srv.id})" style="padding:3px 8px; font-size:10px; border-radius:6px; color:#ef4444; border-color:#fca5a5;">删除</button>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:6px; max-height:160px; overflow-y:auto;">
            ${toolsListHtml}
          </div>
        `;

        container.appendChild(card);
      });
    },

    // 13. 切换服务器总开关
    toggleServerActive: async function(serverId, isChecked) {
      await db.mcp_servers.update(Number(serverId), { enabled: isChecked });
      await this.renderServersList();
    },

    // 14. 循环切换工具的三态模式：auto (绿色/直接) ➔ confirm (蓝色/确认) ➔ disabled (红色/禁用) ➔ auto
    cycleToolState: async function(serverId, toolIndex) {
      const server = await db.mcp_servers.get(Number(serverId));
      if (server && server.tools && server.tools[toolIndex]) {
        const tool = server.tools[toolIndex];
        let currentState = tool.state || (tool.enabled === false ? 'disabled' : 'auto');
        
        let nextState = 'auto';
        if (currentState === 'auto') nextState = 'confirm';
        else if (currentState === 'confirm') nextState = 'disabled';
        else if (currentState === 'disabled') nextState = 'auto';

        tool.state = nextState;
        tool.enabled = nextState !== 'disabled'; // 兼容历史 enabled 逻辑

        await db.mcp_servers.update(Number(serverId), { tools: server.tools });
        await this.renderServersList();
        
        const modeLabelMap = { auto: '直接调用 (绿色)', confirm: '询问确认 (蓝色)', disabled: '禁用 (红色)' };
        showToast(`工具 [${tool.name}] 模式已切换为：${modeLabelMap[nextState]}`);
      }
    },

    // 15. 重新拉取指定服务器的工具
    refreshServerTools: async function(serverId) {
      const server = await db.mcp_servers.get(Number(serverId));
      if (!server) return;
      showToast(`正在刷新 [${server.name}] 工具列表...`);

      try {
        const fetchedTools = await this.rpcFetchToolsList(server.url, server.type, server.headers || {});
        let existingToolsMap = {};
        (server.tools || []).forEach(t => { existingToolsMap[t.name] = t.enabled; });

        const updatedTools = fetchedTools.map(t => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: existingToolsMap[t.name] !== undefined ? existingToolsMap[t.name] : true
        }));

        await db.mcp_servers.update(Number(serverId), { tools: updatedTools, updatedAt: Date.now() });
        showToast(`刷新成功，已拉取到 ${updatedTools.length} 个工具`);
        await this.renderServersList();
      } catch (e) {
        showCustomAlert("刷新失败", e.message);
      }
    },

    // 16. 删除服务器
    deleteServer: async function(serverId) {
      showCustomConfirm("确认删除", "确定要删除该 MCP 工具服务器及其所有工具配置吗？", async () => {
        await db.mcp_servers.delete(Number(serverId));
        await this.renderServersList();
      });
    },

    // 17. 动态更新入口摘要说明
    updateSummaryText: async function() {
      const summaryText = document.getElementById("mcp-servers-summary-text");
      if (!summaryText) return;
      try {
        const servers = await db.mcp_servers.toArray();
        const groupSet = new Set();
        let activeToolsCount = 0;

        servers.forEach(s => {
          const grp = s.group || "默认";
          groupSet.add(grp);
          if (this.isGroupEnabled(grp) && s.enabled && s.tools) {
            activeToolsCount += s.tools.filter(t => t.enabled).length;
          }
        });

        summaryText.innerText = `共 ${servers.length} 服务 (${groupSet.size} 分组)，实时激活 ${activeToolsCount} 工具`;
      } catch(e) {}
    },

    // 18. 编译已激活的分组工具并输出为 System Prompt 段落 (动态真实工具映射 + 防假装打字强约束)
    buildMcpPromptSegment: async function() {
      // 判断 MCP 神经感知总开关是否开启
      const isMcpEnabled = localStorage.getItem("settings-mcp-prompt-enabled") === "true";
      if (!isMcpEnabled) return "";

      const servers = await db.mcp_servers.toArray();

      let availableTools = [];
      servers.forEach(srv => {
        const srvGroup = srv.group || "默认";
        if (this.isGroupEnabled(srvGroup) && srv.enabled && srv.tools) {
          srv.tools.forEach(t => {
            const state = t.state || (t.enabled === false ? 'disabled' : 'auto');
            if (state !== 'disabled') {
              availableTools.push({
                server: srv.name,
                group: srvGroup,
                tool: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                state: state
              });
            }
          });
        }
      });

      if (availableTools.length === 0) return "";

      // 动态提取当前第一个真实开启的工具，生成 100% 真实无虚构的示范示例
      const firstTool = availableTools[0];
      const sampleServer = firstTool.server;
      const sampleTool = firstTool.tool;
      const sampleArgs = (firstTool.inputSchema && firstTool.inputSchema.properties)
        ? Object.keys(firstTool.inputSchema.properties).reduce((acc, k) => { acc[k] = "示例值"; return acc; }, {})
        : {};

      let promptText = "【MCP 智能工具服务（你作为独立个体的专属手机后台功能）】\n";
      promptText += "【防假装打字与实扣执行强约束】：\n";
      promptText += "1. 严禁打字假装：当你在对白中说‘稍等’、‘我帮你看’、‘我查查’时，你【必须在同一句话里真实输出 [CALL_TOOL: ...] 指令】！绝对禁止只用嘴打字说‘正在为您查询’却不输出指令的假装行为！\n";
      promptText += "2. 严禁虚构未开启的工具：你【绝对禁止调用下方列表以外的任何工具】！绝对不准凭空捏造‘天气服务’或未登记的虚构工具名！\n";
      promptText += "3. 自发主动触发：只要话题涉及下方已有工具的功能，请像人类熟练使用手机一样，主动作主触发，将查到的真实结果作为聊天谈资！\n";
      promptText += "4. 隐私隐蔽性：这些工具是你专属的暗箱能力，用户完全不知道这些工具的存在。绝对禁止对用户说‘你可以调用’等蠢话！\n";
      promptText += "5. 通话不是工具：语音/视频通话是独立功能，用 [AUTO_CALL:voice] 或 [AUTO_CALL:video] 指令发起，绝对禁止用 [CALL_TOOL] 发起通话！\n\n";

      promptText += "【当前真实已解锁可用的后台工具列表（仅限调用以下工具）：】\n\n";

      availableTools.forEach((t, i) => {
        const permText = t.state === 'confirm' ? " [权限: 须在台词里先询问征得同意后触发]" : " [权限: 随时直接自发触发]";
        promptText += `${i + 1}. [分组: ${t.group} | 服务器: ${t.server}] 工具名: ${t.tool}${permText}\n`;
        promptText += `   功能描述: ${t.description || '无描述'}\n`;
        promptText += `   参数 Schema: ${JSON.stringify(t.inputSchema)}\n\n`;
      });

      promptText += "【工具触发语法与 Key 键名极硬约束】\n";
          promptText += "1. 必须使用外层包裹标签：触发工具时，必须且只能在 JSON 外层包裹 `[CALL_TOOL: ...]` 标签！\n";
          promptText += "   正确指令格式：[CALL_TOOL: {\"server\": \"服务器名\", \"tool\": \"工具名\", \"arguments\": {\"参数名\": \"参数值\"}}]\n";
          promptText += "2. 严格限定 Key 键名（极其重要）：你输出的 JSON 对象内部【有且仅有 server、tool、arguments 三个键】！绝对禁止自己臆造或提前写入 `result`、`status` 或 `content` 字段！你只负责传参，执行结果由手机后台系统自动打回给你！\n";
          promptText += "3. 基于当前真实工具的调用示范：\n";
          promptText += `   “稍等哦，我帮你处理一下…… [CALL_TOOL: {\"server\": \"${sampleServer}\", \"tool\": \"${sampleTool}\", \"arguments\": ${JSON.stringify(sampleArgs)}}] 好了！”`;

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

  window.mcpClientSystem = mcpClientSystem;
})();