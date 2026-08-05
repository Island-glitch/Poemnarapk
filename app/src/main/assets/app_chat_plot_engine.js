/**
 * app_chat_plot_engine.js - 剧情引擎走向配置控制中心 (自绑定自闭环版)
 */

(function() {
  const plotEngineSystem = {
    // 开启剧情配置模态窗
    openModal: async function() {
      if (!activeSessionId) {
        alert("请先进入一个有效的会话界面。");
        return;
      }
      
      try {
        const sess = await db.sessions.get(activeSessionId);
        const reqInput = document.getElementById("plot-engine-requirement");
        if (reqInput) {
          reqInput.value = sess?.plotRequirement || "";
        }
        
        document.getElementById("plot-engine-overlay").classList.add("active");
      } catch (err) {
        console.error("无法载入剧情引擎当前配置: ", err);
      }
    },

    // 关闭模态窗
    closeModal: function() {
      document.getElementById("plot-engine-overlay").classList.remove("active");
    },

    // 保存剧情发展要求，写入当前 sessions 表中
    saveRequirement: async function() {
      if (!activeSessionId) return;

      const reqInput = document.getElementById("plot-engine-requirement");
      const requirement = reqInput ? reqInput.value.trim() : "";

      try {
        await db.sessions.update(activeSessionId, {
          plotRequirement: requirement
        });
        
        if (requirement) {
          alert("剧本要求已成功载入！后续对话将高度遵循此剧情背景演进。");
        } else {
          alert("剧情中枢已重置，会话恢复为普通自由聊天模式。");
        }
        this.closeModal();
      } catch (err) {
        console.error("写入剧情走向失败: ", err);
        alert("写入剧情中枢失败: " + err.message);
      }
    }
  };

  // 防御性自注册事件：支持 DOMContentLoaded 及同步冷启动的双向容灾绑定
  function bindPlotEngineTrigger() {
    const btn = document.getElementById("btn-chat-plot-engine");
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        document.getElementById("chat-expand-panel").classList.remove("active");
        plotEngineSystem.openModal();
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindPlotEngineTrigger);
  } else {
    bindPlotEngineTrigger();
  }

  window.plotEngineSystem = plotEngineSystem;
})();