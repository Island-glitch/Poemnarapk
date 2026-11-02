/**
 * app_local_deploy.js - 本地部署中心（Termux 脚本管理）
 * 内置网易云 API(3000) + CORS 跨域中转(3001)；
 * 部署引导命令内置全部脚本内容（heredoc 直接在 Termux 创建文件，无需联网下载）；
 * 每个脚本提供「查看 / 编辑 / 删除」，查看可展开面板显示详情与脚本源码。
 *
 * 本文件为自包含实现：全部内置脚本源码直接随文件分发，
 * 部署时通过 heredoc 在 Termux 本地创建文件，无需联网下载。
 */
(function () {
  "use strict";

  function showToastSafe(msg) {
    if (typeof window.showToast === "function") window.showToast(msg);
    else console.log("[local-deploy]", msg);
  }
  function esc(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // 复制：clipboard API -> 隐藏 textarea + execCommand 兜底
  function copyText(text, onDone) {
    var done = function (ok) {
      if (typeof onDone === "function") onDone(ok);
      if (typeof window.showToast === "function") window.showToast(ok ? "已复制到剪贴板" : "复制失败，请长按选中文本手动复制");
    };
    if (!text) { done(false); return; }
    var fallbackCopy = function () {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(ta);
        sel.addRange(range);
        ta.setSelectionRange(0, text.length);
        ta.focus();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { fallbackCopy(); });
    } else {
      fallbackCopy();
    }
  }

  // ============ 内置脚本文件内容（由 tools/sync-embedded-assets.js 同步，勿手改）============
  var CORS_PROXY_SOURCE = `// 叙事诗小手机 - 内置 CORS 跨域中转代理（端口 3001）
// 用途：为 PWA/网页版打破跨域限制，代理任意 HTTP/HTTPS 请求
// 启动：node cors-proxy.js
const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康检查
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'storyphone-cors-proxy', port: PORT }));
    return;
  }

  // 代理格式: /proxy?url=<目标URL>
  const parsed = url.parse(req.url, true);
  const target = parsed.query.url || '';
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing url param', usage: '/proxy?url=https://example.com' }));
    return;
  }

  let targetUrl;
  try { targetUrl = new URL(target); } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid url' }));
    return;
  }

  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding'];

  const proxyReq = lib.request(targetUrl, {
    method: req.method,
    headers: headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy error', message: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(\`[storyphone-cors-proxy] running @ http://localhost:\${PORT}\`);
});
`;
  var SERVICES_MANAGER_SOURCE = `#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# 叙事诗小手机 - Termux 服务管理器（独立启停 + 状态读取 + 数据持久化）
# ------------------------------------------------------------
# 功能：
#  1. 统一管理所有本地脚本服务（网易云 API / CORS 跨域中转 / 用户自定义）
#  2. 每个服务独立启停，状态写入 $XSH_DIR/status/*.json
#  3. 登录态 Cookie 等数据持久化到 $XSH_DIR/data/
#  4. 提供可交互 TUI 菜单（bash 纯终端，无需额外依赖）
#  5. 提供子命令供外部调用：start|stop|restart|status|list|tui
# ------------------------------------------------------------
# 说明：cors-proxy.js 为内置脚本，部署时随本文件一起写入
#       $XSH_DIR/cors-proxy.js（内容与仓库 termux/cors-proxy.js 一致），
#       无需联网下载；缺失时重新复制 App「本地部署 → 部署引导」命令即可。
# 随时唤出：部署时已把 storyphone 安装到 $PREFIX/bin，之后在 Termux
#       直接输入 storyphone 即可再次进入本交互页面（无需输入长命令）。
# ------------------------------------------------------------
# 用法：
#   bash storyphone-services.sh tui      # 进入交互式管理菜单
#   bash storyphone-services.sh list     # 列出全部服务与状态
#   bash storyphone-services.sh start ncm-api
#   bash storyphone-services.sh stop  ncm-api
#   bash storyphone-services.sh status ncm-api
# ============================================================

# ---------- 基础配置 ----------
XSH_DIR="\${XSH_DIR:-$HOME/.storyphone}"
DATA_DIR="$XSH_DIR/data"      # 持久化数据（登录 cookie 等）
STATUS_DIR="$XSH_DIR/status"  # 各服务运行状态 JSON
LOG_DIR="$XSH_DIR/logs"       # 各服务日志
PID_DIR="$XSH_DIR/pids"       # PID 文件
mkdir -p "$DATA_DIR" "$STATUS_DIR" "$LOG_DIR" "$PID_DIR"

# ---------- 颜色 ----------
C_G="\\033[32m"; C_R="\\033[31m"; C_Y="\\033[33m"; C_B="\\033[34m"; C_C="\\033[36m"
C_DIM="\\033[2m"; C_BOLD="\\033[1m"; C_END="\\033[0m"

# ---------- 服务注册表 ----------
# 格式: 服务ID|显示名|描述|启动命令|健康检查URL|停止方式(kill|pkill)
SERVICES=(
  "ncm-api|网易云音乐 API|网易云登录代理/歌单同步/歌词搜索|NeteaseCloudMusicApi -p 3000|http://localhost:3000|kill"
  "cors-proxy|CORS 跨域中转|打破 PWA/网页版跨域限制|node \\$HOME/.storyphone/cors-proxy.js|http://localhost:3001/health|kill"
  "cmd-runner|AI 命令执行服务|工作台 Agent 执行 termux 命令/git 仓库操作（端口 3002）|node \\$HOME/.storyphone/cmd-runner.js|http://localhost:3002/health|kill"
  "link-meta|分享链接解析服务|解析小红书/B站等分享链接的标题/封面/摘要（端口 3003）|node \\$HOME/.storyphone/link-meta.js|http://localhost:3003/health|kill"
)

# ---------- 用户自定义服务（追加到数组末尾） ----------
USER_SERVICES_FILE="$XSH_DIR/services.conf"
if [ -f "$USER_SERVICES_FILE" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \\#*) continue;; esac
    SERVICES+=("$line")
  done < "$USER_SERVICES_FILE"
fi

# ---------- 内置脚本自愈（缺失时从 App 导出的手机存储目录补齐） ----------
builtin_script_file() {
  case "$1" in
    cors-proxy) echo "$HOME/.storyphone/cors-proxy.js" ;;
    cmd-runner) echo "$HOME/.storyphone/cmd-runner.js" ;;
    link-meta) echo "$HOME/.storyphone/link-meta.js" ;;
    *) echo "" ;;
  esac
}

ensure_script() {
  local id="$1" file base
  file=$(builtin_script_file "$id")
  [ -z "$file" ] && return 0
  [ -f "$file" ] && [ -s "$file" ] && return 0
  base=$(basename "$file")
  log "${C_Y}[!]${C_END} 缺少脚本文件: $file，尝试自动补齐..."
  mkdir -p "$(dirname "$file")"
  # 从 App 导出的手机存储目录复制（无需网络）
  for src in "/sdcard/Download/Storypoem/storyphone-scripts/$base" "/storage/emulated/0/Download/Storypoem/storyphone-scripts/$base"; do
    if [ -f "$src" ] && cp "$src" "$file" 2>/dev/null && [ -s "$file" ]; then
      log "${C_G}[✓]${C_END} 已从手机存储补齐: $file"
      return 0
    fi
  done
  rm -f "$file" 2>/dev/null
  log "${C_R}[x]${C_END} 自动补齐失败，请重新复制 App「本地部署→部署引导」命令"
  return 1
}

repair_all() {
  log ""
  log "\${C_BOLD}修复/补齐内置脚本\${C_END}"
  local ok=0 fail=0
  for id in cors-proxy cmd-runner link-meta; do
    if ensure_script "$id"; then ok=$((ok+1)); else fail=$((fail+1)); fi
  done
  log "------------------------------------------"
  log "\${C_G}已就绪: $ok\${C_END}  \${C_R}失败: $fail\${C_END}"
  log "\${C_DIM}提示: 还需 pkg install -y nodejs-lts git curl 以运行脚本与 git 工具\${C_END}"
  log ""
}

# ---------- 工具函数 ----------
log() { echo -e "$*"; }
now() { date '+%Y-%m-%d %H:%M:%S'; }

pid_file() { echo "$PID_DIR/$1.pid"; }
log_file() { echo "$LOG_DIR/$1.log"; }
status_file() { echo "$STATUS_DIR/$1.json"; }

# 写入服务状态 JSON
write_status() {
  local id="$1" state="$2" pid="$3" ts
  ts=$(now)
  cat > "$(status_file "$id")" <<EOF
{"id":"$id","status":"$state","pid":\${pid:-0},"updatedAt":"$ts"}
EOF
}

# 读取某服务的 PID（若进程存活）
get_pid() {
  local id="$1" pf pid
  pf=$(pid_file "$id")
  [ -f "$pf" ] || { echo ""; return; }
  pid=$(cat "$pf" 2>/dev/null | tr -d ' ')
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
  else
    echo ""
  fi
}

is_running() {
  local id="$1" pid cmd keyword mainfile mainfile_expanded
  pid=$(get_pid "$id")
  [ -n "$pid" ] && return 0
  cmd=$(get_cmd "$id")
  # 若命令指向本地脚本文件，优先用脚本路径精确匹配，
  # 避免与其它 node 进程（如网易云 API）混淆导致误判已在运行
  mainfile=$(echo "$cmd" | sed -n 's/^[^ ]* \\([^ ]*\\.\\(js\\|sh\\)\\).*/\\1/p')
  if [ -n "$mainfile" ]; then
    mainfile_expanded=$(eval echo "$mainfile")
    if pgrep -f "$mainfile_expanded" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  keyword=$(echo "$cmd" | awk '{print $1}')
  if pgrep -f "$keyword" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

get_cmd() {
  local id="$1" entry
  for entry in "\${SERVICES[@]}"; do
    if [ "\${entry%%|*}" = "$id" ]; then
      echo "$entry" | cut -d'|' -f4
      return
    fi
  done
  echo ""
}

get_name() {
  local id="$1" entry
  for entry in "\${SERVICES[@]}"; do
    if [ "\${entry%%|*}" = "$id" ]; then
      echo "$entry" | cut -d'|' -f2
      return
    fi
  done
  echo "$id"
}

# ---------- 启动服务 ----------
start_service() {
  local id="$1" cmd name logf pf pid mainfile
  name=$(get_name "$id")
  if is_running "$id"; then
    log "\${C_Y}[!]\${C_END} $name 已在运行（PID: $(get_pid "$id")）"
    return 0
  fi
  cmd=$(get_cmd "$id")
  [ -z "$cmd" ] && { log "\${C_R}[x]\${C_END} 未知服务: $id"; return 1; }

  # 预检：若命令指向本地脚本文件，先确认文件存在；缺失则尝试自动下载补齐
  mainfile=$(echo "$cmd" | sed -n 's/^[^ ]* \\([^ ]*\\.\\(js\\|sh\\)\\).*/\\1/p')
  if [ -n "$mainfile" ]; then
    # 展开 $HOME 变量
    mainfile_expanded=$(eval echo "$mainfile")
    if [ ! -s "$mainfile_expanded" ]; then
      if ! ensure_script "$id"; then
        log "\${C_R}[x]\${C_END} $name 启动失败：脚本文件缺失 $mainfile_expanded"
        log "\${C_Y}[!]\${C_END} 可执行 storyphone repair 自动补齐，或重新复制 App「本地部署→部署引导」命令。"
        write_status "$id" "error" ""
        return 1
      fi
      if [ ! -s "$mainfile_expanded" ]; then
        log "\${C_R}[x]\${C_END} $name 启动失败：脚本文件仍缺失"
        write_status "$id" "error" ""
        return 1
      fi
    fi
  fi

  logf=$(log_file "$id")
  pf=$(pid_file "$id")
  log "\${C_B}[*]\${C_END} 启动 $name ..."
  eval "nohup bash -c '$cmd' >> \\"$logf\\" 2>&1 &"
  echo $! > "$pf"
  sleep 1
  pid=$(get_pid "$id")
  if [ -n "$pid" ]; then
    write_status "$id" "running" "$pid"
    log "\${C_G}[✓]\${C_END} $name 已启动 (PID: $pid)"
  else
    write_status "$id" "error" ""
    log "\${C_R}[x]\${C_END} $name 启动失败，请查看日志: $logf"
    log "\${C_Y}[!]\${C_END} 日志内容: $(tail -5 "$logf" 2>/dev/null | tr '\\n' ' ')"
    if tail -30 "$logf" 2>/dev/null | grep -q "Cannot find module"; then
      log "\${C_Y}[!]\${C_END} 检测到脚本文件缺失（Cannot find module）→ 执行 \${C_C}storyphone repair\${C_END} 可自动补齐"
    fi
  fi
}

# ---------- 停止服务 ----------
stop_service() {
  local id="$1" name pid cmd keyword mainfile mainfile_expanded
  name=$(get_name "$id")
  # 1) 按 PID 文件停止外层包装进程
  pid=$(get_pid "$id")
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
    fi
  fi
  # 2) 再按脚本路径/关键字兜底清理真实进程（包装 shell 退出后子进程可能残留）
  cmd=$(get_cmd "$id")
  mainfile=$(echo "$cmd" | sed -n 's/^[^ ]* \\([^ ]*\\.\\(js\\|sh\\)\\).*/\\1/p')
  if [ -n "$mainfile" ]; then
    mainfile_expanded=$(eval echo "$mainfile")
    pkill -f "$mainfile_expanded" 2>/dev/null
  else
    keyword=$(echo "$cmd" | awk '{print $1}')
    pkill -f "$keyword" 2>/dev/null
  fi
  sleep 1
  if is_running "$id"; then
    log "\${C_R}[x]\${C_END} $name 停止失败，进程仍在运行"
    return 1
  fi
  write_status "$id" "stopped" ""
  log "\${C_G}[✓]\${C_END} $name 已停止"
}

# ---------- 状态展示 ----------
show_status() {
  local id="$1" name pid
  id="$1"; name=$(get_name "$id"); pid=$(get_pid "$id")
  if [ -n "$pid" ]; then
    write_status "$id" "running" "$pid"
    log "  \${C_G}●\${C_END} $name  \${C_G}运行中\${C_END} (PID $pid)"
  else
    write_status "$id" "stopped" ""
    log "  \${C_DIM}○\${C_END} $name  \${C_R}已停止\${C_END}"
  fi
}

# ---------- 列出全部 ----------
list_all() {
  log ""
  log "\${C_BOLD}叙事诗小手机 - Termux 服务列表\${C_END}"
  log "\${C_DIM}数据目录: $XSH_DIR\${C_END}"
  log "------------------------------------------"
  local entry id
  for entry in "\${SERVICES[@]}"; do
    id="\${entry%%|*}"
    show_status "$id"
  done
  log "------------------------------------------"
  log ""
}

# ---------- 交互式 TUI 菜单 ----------
tui_menu() {
  while true; do
    clear 2>/dev/null || true
    log "\${C_BOLD}============================================\${C_END}"
    log "\${C_BOLD}  叙事诗小手机 - Termux 服务管理器\${C_END}"
    log "\${C_BOLD}============================================\${C_END}"
    list_all
    log "  请输入操作:"
    log "  \${C_C}[1]\${C_END} 启动全部服务"
    log "  \${C_C}[2]\${C_END} 停止全部服务"
    log "  \${C_C}[3]\${C_END} 查看服务日志"
    log "  \${C_C}[4]\${C_END} 一键部署/修复依赖"
    log "  \${C_C}[5]\${C_END} 查看持久化数据文件"
    log "  \${C_C}[6]\${C_END} 修复/补齐内置脚本（cmd-runner 等）"
    log "  \${C_C}[0]\${C_END} 退出"
    log ""
    log "  \${C_DIM}—— 单独启停（推荐分开启动，避免相互干扰）——\${C_END}"
    local idx entry id
    idx=0
    for entry in "\${SERVICES[@]}"; do
      idx=$((idx+1))
      id="\${entry%%|*}"
      log "  \${C_C}[S\${idx}]\${C_END} 启动 \${id}"
      log "  \${C_C}[T\${idx}]\${C_END} 停止 \${id}"
    done
    log ""
    printf "  选择: "
    read -r choice
    case "$choice" in
      1) for entry in "\${SERVICES[@]}"; do start_service "\${entry%%|*}"; done; sleep 1;;
      2) for entry in "\${SERVICES[@]}"; do stop_service "\${entry%%|*}"; done; sleep 1;;
      3) tui_logs;;
      4) tui_repair;;
      5) tui_data;;
      6) repair_all; sleep 1;;
      0) log "再见！随时输入 \${C_C}storyphone\${C_END} 可再次唤出本页面"; exit 0;;
      S1|s1) [ -n "\${SERVICES[0]}" ] && start_service "\${SERVICES[0]%%|*}"; sleep 1;;
      S2|s2) [ -n "\${SERVICES[1]}" ] && start_service "\${SERVICES[1]%%|*}"; sleep 1;;
      S3|s3) [ -n "\${SERVICES[2]}" ] && start_service "\${SERVICES[2]%%|*}"; sleep 1;;
      T1|t1) [ -n "\${SERVICES[0]}" ] && stop_service "\${SERVICES[0]%%|*}"; sleep 1;;
      T2|t2) [ -n "\${SERVICES[1]}" ] && stop_service "\${SERVICES[1]%%|*}"; sleep 1;;
      T3|t3) [ -n "\${SERVICES[2]}" ] && stop_service "\${SERVICES[2]%%|*}"; sleep 1;;
      S4|s4) [ -n "\${SERVICES[3]}" ] && start_service "\${SERVICES[3]%%|*}"; sleep 1;;
      T4|t4) [ -n "\${SERVICES[3]}" ] && stop_service "\${SERVICES[3]%%|*}"; sleep 1;;
      *) log "无效选项"; sleep 1;;
    esac
  done
}

tui_logs() {
  log ""
  log "可选日志:"
  local idx entry id
  idx=0
  for entry in "\${SERVICES[@]}"; do
    id="\${entry%%|*}"
    idx=$((idx+1))
    log "  [$idx] $id"
  done
  printf "查看哪个服务的日志? (0=返回): "
  read -r choice
  [ "$choice" = "0" ] && return
  local count=0 entry
  for entry in "\${SERVICES[@]}"; do
    count=$((count+1))
    if [ "$count" = "$choice" ]; then
      id="\${entry%%|*}"
      log "--- $id 日志 (tail -30) ---"
      tail -30 "$(log_file "$id")" 2>/dev/null || log "(无日志)"
      printf "按回车返回..."
      read -r _
      return
    fi
  done
}

tui_repair() {
  log ""
  log "\${C_BOLD}一键部署/修复依赖\${C_END}"
  log "  1. 更新软件源: pkg update -y"
  log "  2. 安装 nodejs: pkg install -y nodejs-lts"
  log "  3. 安装网易云 API: npm install -g NeteaseCloudMusicApi --registry=https://registry.npmmirror.com"
  log "  4. 重建脚本文件: 重新复制 App「本地部署 → 部署引导」的部署命令执行即可（已内置脚本内容，无需下载）"
  printf "  立即执行? (y/N): "
  read -r yn
  case "$yn" in
    y|Y)
      pkg update -y || true
      pkg install -y nodejs-lts || true
      npm install -g NeteaseCloudMusicApi --registry=https://registry.npmmirror.com || true
      log "\${C_G}[✓]\${C_END} 依赖部署完成"
      log "\${C_Y}[!]\${C_END} 若 cors-proxy.js / storyphone-services.sh 缺失，请重新复制 App 部署引导命令"
      ;;
    *) log "已取消";;
  esac
  sleep 1
}

tui_data() {
  log ""
  log "\${C_BOLD}持久化数据文件 (\${C_DIM}$DATA_DIR\${C_END}\${C_BOLD})\${C_END}"
  ls -la "$DATA_DIR" 2>/dev/null | head -20
  log ""
  printf "按回车返回..."
  read -r _
}

# ---------- 命令分发 ----------
case "\${1:-tui}" in
  start)   start_service "$2" ;;
  stop)    stop_service "$2" ;;
  restart) stop_service "$2"; start_service "$2" ;;
  status)  [ -n "$2" ] && show_status "$2" || list_all ;;
  list)    list_all ;;
  repair)  repair_all ;;
  tui)     tui_menu ;;
  *)       log "用法: bash storyphone-services.sh {tui|list|start <id>|stop <id>|restart <id>|status [id]|repair}";;
esac
`;
  var XSHISHI_LAUNCHER_SOURCE = `#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# 叙事诗小手机 - 脚本交互页面唤出命令
# ------------------------------------------------------------
# 部署（一键部署命令）时本文件会被安装到 $PREFIX/bin/storyphone，
# 之后在 Termux 任意位置直接输入：
#     storyphone
# 即可立刻唤出脚本交互页面（服务管理器 TUI），无需再输入长命令。
# 也支持子命令：storyphone repair / storyphone start cmd-runner / storyphone list
# ============================================================
if [ $# -gt 0 ]; then
  exec bash "$HOME/.storyphone/storyphone-services.sh" "$@"
fi
exec bash "$HOME/.storyphone/storyphone-services.sh" tui
`;
var CMD_RUNNER_SOURCE = `
#!/data/data/com.termux/files/usr/bin/env node
// ============================================================
// 叙事诗小手机 - cmd-runner（内置脚本3 · AI 命令执行服务）
// ------------------------------------------------------------
// 用途：让「工作台 Agent」能执行 termux 命令 / 运行自己写的脚本 /
//       做 git 仓库操作（clone/commit/push），并取回 stdout/stderr。
// 原理：在 Termux 内常驻一个只监听 127.0.0.1 的小 HTTP 服务（端口 3002），
//       工作台通过 http://127.0.0.1:3002/run 提交 { cmd, cwd, timeout_ms }。
// 安全：
//   - 只绑定 127.0.0.1（仅本机可访问）；
//   - 若存在 ~/.storyphone/.cmd_token 文件，则要求请求头 X-Cmd-Token 一致才执行
//     （echo -n '你的随机口令' > ~/.storyphone/.cmd_token 即可启用）；
//   - 命令以 Termux 用户身份运行，请勿随意开放给不可信来源。
// 管理：由 storyphone-services.sh 统一启停：storyphone start cmd-runner
// ============================================================

'use strict';
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3002;
const HOME = os.homedir();
const TOKEN_FILE = path.join(HOME, '.storyphone', '.cmd_token');

function token() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null; } catch (e) { return null; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cmd-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function runCmd(cmd, cwd, timeoutMs, cb) {
  const target = (cwd && fs.existsSync(cwd)) ? cwd : HOME;
  exec(cmd, {
    cwd: target,
    timeout: timeoutMs || 90000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8'
  }, function (err, stdout, stderr) {
    cb({
      ok: !err,
      exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      killed: !!(err && err.killed),
      stdout: String(stdout || ''),
      stderr: String(stderr || '')
    });
  });
}

const server = http.createServer(function (req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const tk = token();
  if (tk) {
    const given = req.headers['x-cmd-token'];
    if (given !== tk) { sendJson(res, 403, { ok: false, error: 'token 校验失败（请检查请求头 X-Cmd-Token）' }); return; }
  }

  const url = String(req.url || '/');

  if (req.method === 'GET' && url.indexOf('/health') === 0) {
    exec('git --version', { timeout: 5000 }, function (e, so) {
      sendJson(res, 200, { ok: true, service: 'cmd-runner', port: PORT, git: e ? null : String(so || '').trim() });
    });
    return;
  }

  if (req.method === 'POST' && url.indexOf('/run') === 0) {
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 524288) req.destroy(); });
    req.on('end', function () {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) { sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return; }
      const cmd = String(p.cmd || '').trim();
      if (!cmd) { sendJson(res, 400, { ok: false, error: '缺少 cmd' }); return; }
      runCmd(cmd, String(p.cwd || ''), p.timeout_ms || 90000, function (r) { sendJson(res, 200, r); });
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('[cmd-runner] listening on http://127.0.0.1:' + PORT + (token() ? ' (token 已启用)' : ' (未启用 token，仅绑定本机)'));
});
`;


  // link-meta 源码以 Base64 内嵌（避免模板字符串转义破坏正则/\u 序列）
  var LINK_META_SOURCE_B64 = "IyEvZGF0YS9kYXRhL2NvbS50ZXJtdXgvZmlsZXMvdXNyL2Jpbi9lbnYgbm9kZQovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KLy8g5Y+Z5LqL6K+X5bCP5omL5py6IC0gbGluay1tZXRh77yI5YaF572u6ISa5pysNCDCtyDliIbkuqvpk77mjqXlhYPmlbDmja7op6PmnpDmnI3liqHvvIznq6/lj6MgMzAwM++8iQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLy8g55So6YCU77yaQXBwL+e9kemhteWPlyBXZWJWaWV3IOaymeeuseS4jiBDT1JTIOmZkOWItu+8jOaXoOazleebtOaOpeaKk+WPluWIhuS6q+mTvuaOpeeahOagh+mimC/lsIHpnaIv5pGY6KaB44CCCi8vICAgICAgIOacrOacjeWKoeWcqCBUZXJtdXgg5YaF5Lul44CM5pyN5Yqh56uv44CN6Lqr5Lu95oqT5Y+W5bm26Kej5p6Q77yM6L+U5Zue5bmy5YeAIEpTT04g57uZIEFwcCDmuLLmn5PliIbkuqvljaHniYfjgIIKLy8g6IO95Yqb77yaCi8vICAgLSDot5/pmo/ph43lrprlkJHvvIh4aHNsaW5rLmNuIOefremTviDihpIg5bCP57qi5Lmm56yU6K6wL+S4u+mhte+8iQovLyAgIC0g56e75Yqo56uvIFVBIOS8quijhe+8iOWwj+e6ouS5puWvueahjOmdoiBVQSDkuI3ov5Tlm57lhoXlrrnvvIkKLy8gICAtIOWwj+e6ouS5pueslOiusOOAjOWFqOS/oeaBr+OAje+8muagh+mimC/mraPmlocv5L2c6ICFL+WbvueJh+WIl+ihqCArIOeCuei1ni/mlLbol48v6K+E6K66L+WIhuS6q+aVsCArIOWPkeW4g+aXtumXtAovLyAgICAgKyDor53popjmoIfnrb4gKyDpppblsY/or4TorrrvvIjlkKvlrZDor4TorrrvvInvvIzljbMi54K56L+b6ZO+5o6l6IO955yL5Yiw5LuA5LmI77yM5bCx6L+U5Zue5LuA5LmIIgovLyAgIC0g6YCa55So572R6aG177yab2c6dGl0bGUvb2c6ZGVzY3JpcHRpb24vb2c6aW1hZ2UvdHdpdHRlcjoqIC8gPHRpdGxlPgovLyAgIC0gL2ltZyDlm77niYfku6PnkIbvvIjooaUgQ09SUyDlpLTvvIzkvpsgQXBwIOaKiuW4luWtkOmFjeWbvuWOi+e8qeWQjumaj+a2iOaBr+mAgee7meinhuinieaooeWei++8iQovLyDmjqXlj6PvvJoKLy8gICBHRVQgL2hlYWx0aCAgICAgICAgICAgICAgICDihpIg5YGl5bq35qOA5p+lCi8vICAgR0VUIC9tZXRhP3VybD0855uu5qCH6ZO+5o6lPiAgICDihpIg6L+U5ZueIHtvaywgZmluYWxVcmwsIHNpdGUsIGtpbmQsIHRpdGxlLCBkZXNjLCBhdXRob3IsIGltYWdlc1tdLAovLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaWtlZENvdW50LCBjb2xsZWN0ZWRDb3VudCwgY29tbWVudENvdW50LCBzaGFyZUNvdW50LAovLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwdWJsaXNoVGltZSwgdGFnc1tdLCBub3RlSWQsIGNvbW1lbnRzW10sIGNvbW1lbnRzSGFzTW9yZX0KLy8gICBHRVQgL2ltZz91cmw9POWbvueJh+WcsOWdgD4gICAgIOKGkiDljp/moLfovazlj5Hlm77niYflrZfoioLvvIhBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW46ICrvvIkKLy8gICBHRVQgL3Jhdz91cmw9POebruagh+mTvuaOpT4gICAgIOKGkiDljp/moLfovazlj5HpobXpnaIgSFRNTO+8iOW3peS9nOWPsCBmZXRjaF91cmwg5oqT5q2j5paH5YWc5bqV77yJCi8vIOeuoeeQhu+8mnN0b3J5cGhvbmUgc3RhcnQgbGluay1tZXRhCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQoKJ3VzZSBzdHJpY3QnOwpjb25zdCBodHRwID0gcmVxdWlyZSgnaHR0cCcpOwpjb25zdCBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7CmNvbnN0IHRscyA9IHJlcXVpcmUoJ3RscycpOwoKY29uc3QgUE9SVCA9IHByb2Nlc3MuZW52LlBPUlQgfHwgMzAwMzsKY29uc3QgTUFYX1JFRElSRUNUID0gODsKY29uc3QgVElNRU9VVF9NUyA9IDE1MDAwOwpjb25zdCBNQVhfQllURVMgPSAzICogMTAyNCAqIDEwMjQ7CmNvbnN0IE1BWF9JTUdfQllURVMgPSA4ICogMTAyNCAqIDEwMjQ7CmNvbnN0IE1BWF9JTUFHRVMgPSAyMDsKY29uc3QgTUFYX0NPTU1FTlRTID0gMTI7Cgpjb25zdCBNT0JJTEVfVUEgPSAnTW96aWxsYS81LjAgKGlQaG9uZTsgQ1BVIGlQaG9uZSBPUyAxN18wIGxpa2UgTWFjIE9TIFgpIEFwcGxlV2ViS2l0LzYwNS4xLjE1IChLSFRNTCwgbGlrZSBHZWNrbykgVmVyc2lvbi8xNy4wIE1vYmlsZS8xNUUxNDggU2FmYXJpLzYwNC4xJzsKCmNvbnN0IFNJVEVfTUFQID0gWwogIFsveGhzbGlua1wuY258eGlhb2hvbmdzaHVcLmNvbS9pLCAn5bCP57qi5LmmJ10sCiAgWy8oPzpefFwvXC8pKD86d3d3XC4pPyg/Onh8dHdpdHRlcilcLmNvbS9pLCAnWO+8iOaOqOeJue+8iSddLAogIFsvYmlsaWJpbGlcLmNvbXxiMjNcLnR2L2ksICflk5Tlk6nlk5Tlk6knXSwKICBbL2RvdXlpblwuY29tfGllc2RvdXlpbi9pLCAn5oqW6Z+zJ10sCiAgWy93ZWlib1wuKGNufGNvbSkvaSwgJ+W+ruWNmiddLAogIFsvemhpaHVcLmNvbS9pLCAn55+l5LmOJ10sCiAgWy9naXRodWJcLmNvbS9pLCAnR2l0SHViJ10sCiAgWy95b3V0dWJlXC5jb218eW91dHVcLmJlL2ksICdZb3VUdWJlJ10sCiAgWy90YW9iYW9cLmNvbXx0bWFsbFwuY29tfHRiXC5jbi9pLCAn5reY5a6dJ10sCiAgWy9qZFwuY29tL2ksICfkuqzkuJwnXSwKICBbL211c2ljXC4xNjNcLmNvbS9pLCAn572R5piT5LqR6Z+z5LmQJ10sCiAgWy95XC5xcVwuY29tfHFxXC5jb20vaSwgJ1FR6Z+z5LmQJ10sCiAgWy9tcFwud2VpeGluXC5xcVwuY29tL2ksICflvq7kv6HlhazkvJflj7cnXQpdOwoKZnVuY3Rpb24gY29ycyhyZXMpIHsKICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpOwogIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLCAnR0VULCBPUFRJT05TJyk7CiAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsICcqJyk7CiAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtTWF4LUFnZScsICc4NjQwMCcpOwp9CgpmdW5jdGlvbiBzZW5kSnNvbihyZXMsIGNvZGUsIG9iaikgewogIGNvcnMocmVzKTsKICByZXMud3JpdGVIZWFkKGNvZGUsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04JyB9KTsKICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KG9iaikpOwp9CgpmdW5jdGlvbiBzaXRlT2YodXJsKSB7CiAgZm9yIChjb25zdCBbcmUsIG5hbWVdIG9mIFNJVEVfTUFQKSBpZiAocmUudGVzdCh1cmwpKSByZXR1cm4gbmFtZTsKICB0cnkgeyByZXR1cm4gbmV3IFVSTCh1cmwpLmhvc3RuYW1lOyB9IGNhdGNoIChlKSB7IHJldHVybiAnJzsgfQp9CgpmdW5jdGlvbiB1bmVzY2FwZUpzb24ocykgewogIGlmICghcykgcmV0dXJuICcnOwogIHJldHVybiBTdHJpbmcocykKICAgIC5yZXBsYWNlKC9cXHUwMDJGL2dpLCAnLycpCiAgICAucmVwbGFjZSgvXFx1MDAyZi9nLCAnLycpCiAgICAucmVwbGFjZSgvXFxcLy9nLCAnLycpCiAgICAucmVwbGFjZSgvXFxuL2csICdcbicpCiAgICAucmVwbGFjZSgvXFx0L2csICcgJykKICAgIC5yZXBsYWNlKC9cXCIvZywgJyInKQogICAgLnJlcGxhY2UoL1xcdShbMC05YS1mQS1GXXs0fSkvZywgKG0sIGgpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoaCwgMTYpKSk7Cn0KCmZ1bmN0aW9uIGNsZWFuVGV4dChzKSB7CiAgcmV0dXJuIHVuZXNjYXBlSnNvbihTdHJpbmcocyB8fCAnJykpCiAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnJykKICAgIC5yZXBsYWNlKC9bXHUwMDAwLVx1MDAxZl0vZywgJyAnKQogICAgLnJlcGxhY2UoL1xzKy9nLCAnICcpCiAgICAudHJpbSgpOwp9CgovKiog5bey5pivIEpTT04ucGFyc2Ug5ZCO55qE5a2X56ym5Liy77ya5Y+q5YGa5qCH562+5Yml56a75LiO56m655m95pW055CG77yM5Y+v5L+d55WZ5o2i6KGMICovCmZ1bmN0aW9uIHRpZHlUZXh0KHMsIGtlZXBOZXdsaW5lcykgewogIGxldCB0ID0gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZSgvPFtePl0rPi9nLCAnJykucmVwbGFjZSgvXHIvZywgJycpOwogIGlmIChrZWVwTmV3bGluZXMpIHsKICAgIHQgPSB0LnJlcGxhY2UoL1sgXHRcdTAwYTBdKy9nLCAnICcpLnJlcGxhY2UoL1xuezMsfS9nLCAnXG5cbicpOwogICAgcmV0dXJuIHQuc3BsaXQoJ1xuJykubWFwKChsKSA9PiBsLnRyaW0oKSkuam9pbignXG4nKS50cmltKCk7CiAgfQogIHJldHVybiB0LnJlcGxhY2UoL1xzKy9nLCAnICcpLnRyaW0oKTsKfQoKZnVuY3Rpb24gdG9JbnQodikgewogIGlmICh2ID09IG51bGwpIHJldHVybiBudWxsOwogIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicgJiYgaXNGaW5pdGUodikpIHJldHVybiBNYXRoLnJvdW5kKHYpOwogIGNvbnN0IG0gPSBTdHJpbmcodikucmVwbGFjZSgvW15cZC5dL2csICcnKTsKICBpZiAoIW0pIHJldHVybiBudWxsOwogIGNvbnN0IGYgPSBwYXJzZUZsb2F0KG0pOwogIHJldHVybiBpc05hTihmKSA/IG51bGwgOiBNYXRoLnJvdW5kKGYpOwp9CgpmdW5jdGlvbiB0b0h0dHBzKHUpIHsKICBjb25zdCBzID0gU3RyaW5nKHUgfHwgJycpOwogIGlmICgvXmh0dHA6XC9cLy9pLnRlc3QocykpIHJldHVybiAnaHR0cHM6Ly8nICsgcy5zbGljZSg3KTsKICByZXR1cm4gczsKfQoKLy8gLS0tLSDlj6/pgInku6PnkIbvvJrlooPlpJbnq5nngrnvvIhYL1R3aXR0ZXLjgIFHaXRIdWIg562J77yJ5Zyo5omL5py65LiK6YCa5bi46ZyA6KaB6LWw5Luj55CGIC0tLS0KLy8g5Y+q6KaB6K6+572u5LqGIEhUVFBTX1BST1hZIC8gQUxMX1BST1hZ77yI5L6L5aaCIENsYXNoIOeahCBodHRwOi8vMTI3LjAuMC4xOjc4OTDvvInvvIzmnKzmnI3liqHlsLHotbAgQ09OTkVDVCDpmqfpgZPjgIIKY29uc3QgUFJPWFlfVVJMID0gcHJvY2Vzcy5lbnYuSFRUUFNfUFJPWFkgfHwgcHJvY2Vzcy5lbnYuQUxMX1BST1hZIHx8IHByb2Nlc3MuZW52Lmh0dHBzX3Byb3h5IHx8ICcnOwoKLyoqIOe7n+S4gCBHRVTvvJrml6Dku6PnkIbnm7Tov57vvJvmnInku6PnkIbml7blhYggQ09OTkVDVCDlho3lnKjpmqfpgZPkuIrlj5EgSFRUUFMg6K+35rGCICovCmZ1bmN0aW9uIHJhd0dldCh1LCBoZWFkZXJzLCBvblJlc3AsIG9uRXJyKSB7CiAgY29uc3QgaXNIdHRwcyA9IHUucHJvdG9jb2wgPT09ICdodHRwczonOwogIGNvbnN0IGRpcmVjdCA9IChleHRyYSkgPT4gewogICAgY29uc3QgbGliID0gaXNIdHRwcyA/IGh0dHBzIDogaHR0cDsKICAgIGNvbnN0IHJlcSA9IGxpYi5yZXF1ZXN0KE9iamVjdC5hc3NpZ24oewogICAgICBtZXRob2Q6ICdHRVQnLCBoZWFkZXJzLCB0aW1lb3V0OiBUSU1FT1VUX01TLAogICAgICBob3N0bmFtZTogdS5ob3N0bmFtZSwgcG9ydDogdS5wb3J0IHx8IChpc0h0dHBzID8gNDQzIDogODApLAogICAgICBwYXRoOiB1LnBhdGhuYW1lICsgdS5zZWFyY2gKICAgIH0sIGV4dHJhIHx8IHt9KSwgb25SZXNwKTsKICAgIHJlcS5vbigndGltZW91dCcsICgpID0+IHsgcmVxLmRlc3Ryb3koKTsgb25FcnIobmV3IEVycm9yKCd0aW1lb3V0JykpOyB9KTsKICAgIHJlcS5vbignZXJyb3InLCBvbkVycik7CiAgICByZXEuZW5kKCk7CiAgICByZXR1cm4gcmVxOwogIH07CgogIGxldCBwcm94eSA9IG51bGw7CiAgaWYgKFBST1hZX1VSTCAmJiBpc0h0dHBzKSB7IHRyeSB7IHByb3h5ID0gbmV3IFVSTChQUk9YWV9VUkwpOyB9IGNhdGNoIChlKSB7IHByb3h5ID0gbnVsbDsgfSB9CiAgaWYgKCFwcm94eSkgcmV0dXJuIGRpcmVjdCgpOwoKICBjb25zdCBjb25uZWN0UmVxID0gaHR0cC5yZXF1ZXN0KHsKICAgIGhvc3Q6IHByb3h5Lmhvc3RuYW1lLCBwb3J0OiBwcm94eS5wb3J0IHx8IDgwLCBtZXRob2Q6ICdDT05ORUNUJywKICAgIHBhdGg6IHUuaG9zdG5hbWUgKyAnOjQ0MycsIHRpbWVvdXQ6IFRJTUVPVVRfTVMKICB9KTsKICBjb25uZWN0UmVxLm9uKCdjb25uZWN0JywgKHJlcywgc29ja2V0KSA9PiB7CiAgICBpZiAocmVzLnN0YXR1c0NvZGUgIT09IDIwMCkgeyBzb2NrZXQuZGVzdHJveSgpOyByZXR1cm4gb25FcnIobmV3IEVycm9yKCdwcm94eSBDT05ORUNUICcgKyByZXMuc3RhdHVzQ29kZSkpOyB9CiAgICBjb25zdCB0bHNTb2NrID0gdGxzLmNvbm5lY3QoeyBzb2NrZXQsIHNlcnZlcm5hbWU6IHUuaG9zdG5hbWUgfSwgKCkgPT4gewogICAgICBkaXJlY3QoeyBjcmVhdGVDb25uZWN0aW9uOiAoKSA9PiB0bHNTb2NrLCBob3N0bmFtZTogdS5ob3N0bmFtZSwgcG9ydDogNDQzIH0pOwogICAgfSk7CiAgICB0bHNTb2NrLm9uKCdlcnJvcicsIG9uRXJyKTsKICB9KTsKICBjb25uZWN0UmVxLm9uKCd0aW1lb3V0JywgKCkgPT4geyBjb25uZWN0UmVxLmRlc3Ryb3koKTsgb25FcnIobmV3IEVycm9yKCdwcm94eSB0aW1lb3V0JykpOyB9KTsKICBjb25uZWN0UmVxLm9uKCdlcnJvcicsIG9uRXJyKTsKICBjb25uZWN0UmVxLmVuZCgpOwogIHJldHVybiBjb25uZWN0UmVxOwp9CgovKiog5bim6YeN5a6a5ZCR55qEIEdFVO+8jOi/lOWbniB7IGZpbmFsVXJsLCBib2R5LCBzdGF0dXMgfSAqLwpmdW5jdGlvbiBmZXRjaEZvbGxvdyh0YXJnZXRVcmwsIGRlcHRoKSB7CiAgZGVwdGggPSBkZXB0aCB8fCAwOwogIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICBsZXQgdTsKICAgIHRyeSB7IHUgPSBuZXcgVVJMKHRhcmdldFVybCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIHJlamVjdChuZXcgRXJyb3IoJ2ludmFsaWQgdXJsJykpOyB9CiAgICBsZXQgcmVxID0gbnVsbDsKICAgIHJlcSA9IHJhd0dldCh1LCB7CiAgICAgICdVc2VyLUFnZW50JzogTU9CSUxFX1VBLAogICAgICAnQWNjZXB0JzogJ3RleHQvaHRtbCxhcHBsaWNhdGlvbi94aHRtbCt4bWwsYXBwbGljYXRpb24vanNvbjtxPTAuOSwqLyo7cT0wLjgnLAogICAgICAnQWNjZXB0LUxhbmd1YWdlJzogJ3poLUNOLHpoO3E9MC45LGVuO3E9MC44JywKICAgICAgJ0FjY2VwdC1FbmNvZGluZyc6ICdpZGVudGl0eScKICAgIH0sIChyZXNwKSA9PiB7CiAgICAgIGNvbnN0IGNvZGUgPSByZXNwLnN0YXR1c0NvZGUgfHwgMDsKICAgICAgaWYgKGNvZGUgPj0gMzAwICYmIGNvZGUgPCA0MDAgJiYgcmVzcC5oZWFkZXJzLmxvY2F0aW9uKSB7CiAgICAgICAgaWYgKGRlcHRoID49IE1BWF9SRURJUkVDVCkgeyByZXNwLnJlc3VtZSgpOyByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcigndG9vIG1hbnkgcmVkaXJlY3RzJykpOyB9CiAgICAgICAgY29uc3QgbmV4dCA9IG5ldyBVUkwocmVzcC5oZWFkZXJzLmxvY2F0aW9uLCB1KS50b1N0cmluZygpOwogICAgICAgIHJlc3AucmVzdW1lKCk7CiAgICAgICAgcmV0dXJuIHJlc29sdmUoZmV0Y2hGb2xsb3cobmV4dCwgZGVwdGggKyAxKSk7CiAgICAgIH0KICAgICAgbGV0IHNpemUgPSAwOwogICAgICBjb25zdCBjaHVua3MgPSBbXTsKICAgICAgcmVzcC5vbignZGF0YScsIChjKSA9PiB7CiAgICAgICAgc2l6ZSArPSBjLmxlbmd0aDsKICAgICAgICBpZiAoc2l6ZSA+IE1BWF9CWVRFUykgeyBpZiAocmVxICYmIHJlcS5kZXN0cm95KSByZXEuZGVzdHJveSgpOyByZXR1cm47IH0KICAgICAgICBjaHVua3MucHVzaChjKTsKICAgICAgfSk7CiAgICAgIHJlc3Aub24oJ2VuZCcsICgpID0+IHsKICAgICAgICByZXNvbHZlKHsgZmluYWxVcmw6IHUudG9TdHJpbmcoKSwgc3RhdHVzOiBjb2RlLCBib2R5OiBCdWZmZXIuY29uY2F0KGNodW5rcykudG9TdHJpbmcoJ3V0ZjgnKSB9KTsKICAgICAgfSk7CiAgICB9LCByZWplY3QpOwogICAgcmVxLm9uKCd0aW1lb3V0JywgKCkgPT4geyByZXEuZGVzdHJveSgpOyByZWplY3QobmV3IEVycm9yKCd0aW1lb3V0JykpOyB9KTsKICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpOwogICAgcmVxLmVuZCgpOwogIH0pOwp9CgovKiog5LiL6L295Zu+54mH5a2X6IqC77yI6Lef6ZqP6YeN5a6a5ZCR77yJ77yM6L+U5ZueIHsgdHlwZSwgYnVmIH0gKi8KZnVuY3Rpb24gZmV0Y2hJbWFnZSh0YXJnZXRVcmwsIGRlcHRoKSB7CiAgZGVwdGggPSBkZXB0aCB8fCAwOwogIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICBsZXQgdTsKICAgIHRyeSB7IHUgPSBuZXcgVVJMKHRhcmdldFVybCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIHJlamVjdChuZXcgRXJyb3IoJ2ludmFsaWQgdXJsJykpOyB9CiAgICBjb25zdCBsaWIgPSB1LnByb3RvY29sID09PSAnaHR0cHM6JyA/IGh0dHBzIDogaHR0cDsKICAgIC8vIOWwj+e6ouS5puWbvuW6iu+8iHhoc2Nkbu+8ieWvueiHqui6q+Wfn+WQjSBSZWZlcmVyIOi/lOWbniA0MDPvvIzlv4XpobvkvKroo4XmiJDnq5nlhoXmnaXmupAKICAgIGNvbnN0IHJlZmVyZXIgPSAveGhzY2RuXC5jb218eGlhb2hvbmdzaHVcLmNvbXx4aHNsaW5rXC5jbi9pLnRlc3QodS5ob3N0bmFtZSkKICAgICAgPyAnaHR0cHM6Ly93d3cueGlhb2hvbmdzaHUuY29tLycKICAgICAgOiAodS5vcmlnaW4gKyAnLycpOwogICAgY29uc3QgcmVxID0gbGliLnJlcXVlc3QodSwgewogICAgICBtZXRob2Q6ICdHRVQnLAogICAgICBoZWFkZXJzOiB7CiAgICAgICAgJ1VzZXItQWdlbnQnOiBNT0JJTEVfVUEsCiAgICAgICAgJ0FjY2VwdCc6ICdpbWFnZS9hdmlmLGltYWdlL3dlYnAsaW1hZ2UvYXBuZyxpbWFnZS8qLCovKjtxPTAuOCcsCiAgICAgICAgJ1JlZmVyZXInOiByZWZlcmVyLAogICAgICAgICdBY2NlcHQtRW5jb2RpbmcnOiAnaWRlbnRpdHknCiAgICAgIH0sCiAgICAgIHRpbWVvdXQ6IFRJTUVPVVRfTVMKICAgIH0sIChyZXNwKSA9PiB7CiAgICAgIGNvbnN0IGNvZGUgPSByZXNwLnN0YXR1c0NvZGUgfHwgMDsKICAgICAgaWYgKGNvZGUgPj0gMzAwICYmIGNvZGUgPCA0MDAgJiYgcmVzcC5oZWFkZXJzLmxvY2F0aW9uKSB7CiAgICAgICAgaWYgKGRlcHRoID49IE1BWF9SRURJUkVDVCkgeyByZXNwLnJlc3VtZSgpOyByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcigndG9vIG1hbnkgcmVkaXJlY3RzJykpOyB9CiAgICAgICAgY29uc3QgbmV4dCA9IG5ldyBVUkwocmVzcC5oZWFkZXJzLmxvY2F0aW9uLCB1KS50b1N0cmluZygpOwogICAgICAgIHJlc3AucmVzdW1lKCk7CiAgICAgICAgcmV0dXJuIHJlc29sdmUoZmV0Y2hJbWFnZShuZXh0LCBkZXB0aCArIDEpKTsKICAgICAgfQogICAgICBpZiAoY29kZSAhPT0gMjAwKSB7IHJlc3AucmVzdW1lKCk7IHJldHVybiByZWplY3QobmV3IEVycm9yKCdodHRwICcgKyBjb2RlKSk7IH0KICAgICAgbGV0IHNpemUgPSAwOwogICAgICBjb25zdCBjaHVua3MgPSBbXTsKICAgICAgcmVzcC5vbignZGF0YScsIChjKSA9PiB7CiAgICAgICAgc2l6ZSArPSBjLmxlbmd0aDsKICAgICAgICBpZiAoc2l6ZSA+IE1BWF9JTUdfQllURVMpIHsgcmVxLmRlc3Ryb3koKTsgcmV0dXJuOyB9CiAgICAgICAgY2h1bmtzLnB1c2goYyk7CiAgICAgIH0pOwogICAgICByZXNwLm9uKCdlbmQnLCAoKSA9PiB7CiAgICAgICAgY29uc3QgdHlwZSA9IFN0cmluZyhyZXNwLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddIHx8ICcnKS5zcGxpdCgnOycpWzBdLnRyaW0oKTsKICAgICAgICBpZiAoIS9eaW1hZ2VcLy9pLnRlc3QodHlwZSkpIHJldHVybiByZWplY3QobmV3IEVycm9yKCdub3QgYW4gaW1hZ2U6ICcgKyB0eXBlKSk7CiAgICAgICAgcmVzb2x2ZSh7IHR5cGUsIGJ1ZjogQnVmZmVyLmNvbmNhdChjaHVua3MpIH0pOwogICAgICB9KTsKICAgIH0pOwogICAgcmVxLm9uKCd0aW1lb3V0JywgKCkgPT4geyByZXEuZGVzdHJveSgpOyByZWplY3QobmV3IEVycm9yKCd0aW1lb3V0JykpOyB9KTsKICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpOwogICAgcmVxLmVuZCgpOwogIH0pOwp9CgpmdW5jdGlvbiBtZXRhVGFnKGh0bWwsIHByb3ApIHsKICBjb25zdCByZSA9IG5ldyBSZWdFeHAoJzxtZXRhW14+XSsoPzpwcm9wZXJ0eXxuYW1lKT1bIlwnXScgKyBwcm9wLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXVxcXS9nLCAnXFwkJicpICsgJ1siXCddW14+XSo+JywgJ2knKTsKICBjb25zdCBtID0gaHRtbC5tYXRjaChyZSk7CiAgaWYgKCFtKSByZXR1cm4gJyc7CiAgY29uc3QgYyA9IG1bMF0ubWF0Y2goL2NvbnRlbnQ9WyJcJ10oW1xzXFNdKj8pWyJcJ10vaSk7CiAgcmV0dXJuIGMgPyBjbGVhblRleHQoY1sxXSkgOiAnJzsKfQoKLyoqIOS7juS7u+aEj+S9jee9rui1t+WBmuaLrOWPt+mFjeWvueaIquWPlu+8iOWtl+espuS4si/ovazkuYnmhJ/nn6XvvInvvIznlKjkuo7lj5blhoXltYwgSlNPTiDniYfmrrUgKi8KZnVuY3Rpb24gYmFsYW5jZWRTbGljZShzLCBzdGFydCkgewogIGxldCBkID0gMCwgaW5TdHIgPSBmYWxzZSwgZXNjID0gZmFsc2U7CiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgcy5sZW5ndGg7IGkrKykgewogICAgY29uc3QgY2ggPSBzW2ldOwogICAgaWYgKGluU3RyKSB7CiAgICAgIGlmIChlc2MpIHsgZXNjID0gZmFsc2U7IGNvbnRpbnVlOyB9CiAgICAgIGlmIChjaCA9PT0gJ1xcJykgeyBlc2MgPSB0cnVlOyBjb250aW51ZTsgfQogICAgICBpZiAoY2ggPT09ICciJykgaW5TdHIgPSBmYWxzZTsKICAgICAgY29udGludWU7CiAgICB9CiAgICBpZiAoY2ggPT09ICciJykgeyBpblN0ciA9IHRydWU7IGNvbnRpbnVlOyB9CiAgICBpZiAoY2ggPT09ICd7JyB8fCBjaCA9PT0gJ1snKSBkKys7CiAgICBlbHNlIGlmIChjaCA9PT0gJ30nIHx8IGNoID09PSAnXScpIHsgZC0tOyBpZiAoZCA9PT0gMCkgcmV0dXJuIHMuc2xpY2Uoc3RhcnQsIGkgKyAxKTsgfQogIH0KICByZXR1cm4gJyc7Cn0KCi8qKiDlj5bpobXpnaLlhoXltYwgd2luZG93Ll9fSU5JVElBTF9TVEFURV9f77yI5bCP57qi5Lmm5Li65Y2V6KGMIEpTT07vvIzlj6/og73lkKsgdW5kZWZpbmVkIOmcgOWFnOW6leS/ruWkje+8iSAqLwpmdW5jdGlvbiBleHRyYWN0SW5pdGlhbFN0YXRlKGh0bWwpIHsKICBjb25zdCBtID0gaHRtbC5tYXRjaCgvd2luZG93XC5fX0lOSVRJQUxfU1RBVEVfX1xzKj1ccyovKTsKICBpZiAoIW0pIHJldHVybiBudWxsOwogIGNvbnN0IHN0YXJ0ID0gbS5pbmRleCArIG1bMF0ubGVuZ3RoOwogIGxldCBlbmQgPSBodG1sLmluZGV4T2YoJzwvc2NyaXB0PicsIHN0YXJ0KTsKICBpZiAoZW5kIDwgMCkgZW5kID0gaHRtbC5sZW5ndGg7CiAgY29uc3QgcmF3ID0gaHRtbC5zbGljZShzdGFydCwgZW5kKS50cmltKCkucmVwbGFjZSgvO1xzKiQvLCAnJyk7CiAgdHJ5IHsgcmV0dXJuIEpTT04ucGFyc2UocmF3KTsgfSBjYXRjaCAoZSkge30KICB0cnkgeyByZXR1cm4gSlNPTi5wYXJzZShyYXcucmVwbGFjZSgvOlxzKnVuZGVmaW5lZCg/PVxzKlssfVxdXSkvZywgJzpudWxsJykpOyB9IGNhdGNoIChlKSB7fQogIHJldHVybiBudWxsOwp9CgovKiog5oyJIGtleSDlj5blhoXltYzlr7nosaEv5pWw57uE77yI5q2j5YiZ5a6a5L2NICsg5ous5Y+36YWN5a+5ICsgSlNPTi5wYXJzZe+8ie+8jOS9nOS4uuaVtOmhteino+aekOWksei0peaXtueahOWFnOW6lSAqLwpmdW5jdGlvbiBncmFiSnNvbihodG1sLCBrZXkpIHsKICBjb25zdCBpID0gaHRtbC5pbmRleE9mKCciJyArIGtleSArICciOicpOwogIGlmIChpIDwgMCkgcmV0dXJuIG51bGw7CiAgY29uc3QgcyA9IGh0bWwuaW5kZXhPZigneycsIGkpOwogIGNvbnN0IGEgPSBodG1sLmluZGV4T2YoJ1snLCBpKTsKICBsZXQgc3RhcnQgPSAtMTsKICBpZiAocyA+PSAwICYmIGEgPj0gMCkgc3RhcnQgPSBNYXRoLm1pbihzLCBhKTsKICBlbHNlIHN0YXJ0ID0gcyA+PSAwID8gcyA6IGE7CiAgaWYgKHN0YXJ0IDwgMCkgcmV0dXJuIG51bGw7CiAgY29uc3QgcmF3ID0gYmFsYW5jZWRTbGljZShodG1sLCBzdGFydCk7CiAgaWYgKCFyYXcpIHJldHVybiBudWxsOwogIHRyeSB7IHJldHVybiBKU09OLnBhcnNlKHJhdyk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIG51bGw7IH0KfQoKLyoqIOWwj+e6ouS5puWbvueJh+adoeebriDihpIg5pyA5L2zIFVSTO+8iOS8mOWFiCBoNV8xMDgwIC8gSDVfRFRMIOmrmOa4heeJiO+8iSAqLwpmdW5jdGlvbiBwaWNrSW1hZ2VVcmwoaXRlbSkgewogIGlmICghaXRlbSB8fCB0eXBlb2YgaXRlbSAhPT0gJ29iamVjdCcpIHJldHVybiAnJzsKICBjb25zdCBjYW5kcyA9IFtdOwogIGlmICh0eXBlb2YgaXRlbS51cmwgPT09ICdzdHJpbmcnKSBjYW5kcy5wdXNoKGl0ZW0udXJsKTsKICAoaXRlbS5pbmZvTGlzdCB8fCBbXSkuZm9yRWFjaCgoaWkpID0+IHsgaWYgKGlpICYmIHR5cGVvZiBpaS51cmwgPT09ICdzdHJpbmcnKSBjYW5kcy5wdXNoKGlpLnVybCk7IH0pOwogIGlmICghY2FuZHMubGVuZ3RoKSByZXR1cm4gJyc7CiAgY29uc3QgYmVzdCA9IGNhbmRzLmZpbmQoKHUpID0+IC9oNV8xMDgwfEg1X0RUTC9pLnRlc3QodSkpIHx8IGNhbmRzWzBdOwogIHJldHVybiB0b0h0dHBzKGJlc3QpOwp9CgovKiog6aaW5bGP6K+E6K66IOKGkiDnsr7nroDnu5PmnoQgKi8KZnVuY3Rpb24gbWFwQ29tbWVudChjKSB7CiAgaWYgKCFjIHx8IHR5cGVvZiBjICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7CiAgY29uc3QgdXNlciA9IChjLnVzZXIgJiYgKGMudXNlci5uaWNrbmFtZSB8fCBjLnVzZXIubmlja05hbWUpKSB8fCAnJzsKICBjb25zdCBjb250ZW50ID0gdGlkeVRleHQoYy5jb250ZW50IHx8ICcnLCB0cnVlKTsKICBpZiAoIWNvbnRlbnQgJiYgIXVzZXIpIHJldHVybiBudWxsOwogIHJldHVybiB7CiAgICB1c2VyLAogICAgY29udGVudCwKICAgIGxpa2U6IHRvSW50KGMubGlrZUNvdW50KSB8fCAwLAogICAgaXA6IGMuaXBMb2NhdGlvbiB8fCAnJywKICAgIHRpbWU6IHRvSW50KGMudGltZSkgfHwgMCwKICAgIHN1YnM6IChjLnN1YkNvbW1lbnRzIHx8IFtdKS5zbGljZSgwLCAzKS5tYXAoKHMpID0+ICh7CiAgICAgIHVzZXI6IChzICYmIHMudXNlciAmJiAocy51c2VyLm5pY2tuYW1lIHx8IHMudXNlci5uaWNrTmFtZSkpIHx8ICcnLAogICAgICBjb250ZW50OiB0aWR5VGV4dCgocyAmJiBzLmNvbnRlbnQpIHx8ICcnLCB0cnVlKQogICAgfSkpLmZpbHRlcigocykgPT4gcy5jb250ZW50KQogIH07Cn0KCi8qKiDlsI/nuqLkuabnrJTorrDop6PmnpDvvJrkvJjlhYjmlbTpobUgX19JTklUSUFMX1NUQVRFX18g57uT5p6E5YyW6K+75Y+W77yM5aSx6LSl5Zue6YCA5q2j5YiZICovCmZ1bmN0aW9uIHBhcnNlWGhzTm90ZShodG1sKSB7CiAgY29uc3Qgb3V0ID0gewogICAgdGl0bGU6ICcnLCBkZXNjOiAnJywgYXV0aG9yOiAnJywgaW1hZ2VzOiBbXSwKICAgIGxpa2VkQ291bnQ6IG51bGwsIGNvbGxlY3RlZENvdW50OiBudWxsLCBjb21tZW50Q291bnQ6IG51bGwsIHNoYXJlQ291bnQ6IG51bGwsCiAgICBwdWJsaXNoVGltZTogMCwgdGFnczogW10sIG5vdGVJZDogJycsIGNvbW1lbnRzOiBbXSwgY29tbWVudHNIYXNNb3JlOiBmYWxzZQogIH07CgogIGNvbnN0IHN0ID0gZXh0cmFjdEluaXRpYWxTdGF0ZShodG1sKTsKICBjb25zdCBkYXRhID0gc3QgJiYgc3Qubm90ZURhdGEgJiYgc3Qubm90ZURhdGEuZGF0YTsKICBjb25zdCBub3RlID0gZGF0YSAmJiBkYXRhLm5vdGVEYXRhOwogIGNvbnN0IGNkYXRhID0gZGF0YSAmJiBkYXRhLmNvbW1lbnREYXRhOwoKICBpZiAobm90ZSkgewogICAgb3V0LnRpdGxlID0gdGlkeVRleHQobm90ZS50aXRsZSB8fCAnJyk7CiAgICBvdXQuZGVzYyA9IHRpZHlUZXh0KG5vdGUuZGVzYyB8fCAnJywgdHJ1ZSk7CiAgICBvdXQuYXV0aG9yID0gKG5vdGUudXNlciAmJiAobm90ZS51c2VyLm5pY2tOYW1lIHx8IG5vdGUudXNlci5uaWNrbmFtZSkpIHx8ICcnOwogICAgb3V0Lm5vdGVJZCA9IG5vdGUubm90ZUlkIHx8ICcnOwogICAgb3V0LnB1Ymxpc2hUaW1lID0gdG9JbnQobm90ZS50aW1lKSB8fCAwOwogICAgb3V0LnRhZ3MgPSAobm90ZS50YWdMaXN0IHx8IFtdKS5tYXAoKHQpID0+IHRpZHlUZXh0KCh0ICYmIHQubmFtZSkgfHwgJycpKS5maWx0ZXIoQm9vbGVhbik7CiAgICBjb25zdCBpaSA9IG5vdGUuaW50ZXJhY3RJbmZvIHx8IHt9OwogICAgb3V0Lmxpa2VkQ291bnQgPSB0b0ludChpaS5saWtlZENvdW50KTsKICAgIG91dC5jb2xsZWN0ZWRDb3VudCA9IHRvSW50KGlpLmNvbGxlY3RlZENvdW50KTsKICAgIG91dC5jb21tZW50Q291bnQgPSB0b0ludChpaS5jb21tZW50Q291bnQpOwogICAgb3V0LnNoYXJlQ291bnQgPSB0b0ludChpaS5zaGFyZUNvdW50KTsKICAgIGNvbnN0IHNlZW4gPSB7fTsKICAgIChub3RlLmltYWdlTGlzdCB8fCBbXSkuZm9yRWFjaCgoaXQpID0+IHsKICAgICAgY29uc3QgdSA9IHBpY2tJbWFnZVVybChpdCk7CiAgICAgIGlmICghdSkgcmV0dXJuOwogICAgICBpZiAoL1wvYXZhdGFyXC8vaS50ZXN0KHUpKSByZXR1cm47CiAgICAgIGNvbnN0IGtleSA9IChpdCAmJiBpdC5maWxlSWQpIHx8ICh1Lm1hdGNoKC8xMDQwZ1swLTlhLXpdKy9pKSB8fCBbdV0pWzBdOwogICAgICBpZiAoc2VlbltrZXldKSByZXR1cm47CiAgICAgIHNlZW5ba2V5XSA9IHU7CiAgICB9KTsKICAgIG91dC5pbWFnZXMgPSBPYmplY3QudmFsdWVzKHNlZW4pLnNsaWNlKDAsIE1BWF9JTUFHRVMpOwogIH0KCiAgLy8gLS0tLSDlhZzlupXvvJrmlbTpobUgSlNPTiDop6PmnpDlpLHotKXml7bnlKjmraPliJnpgJDkuKrlrZfmrrXlj5YgLS0tLQogIGlmICghb3V0LnRpdGxlKSB7CiAgICBjb25zdCBtID0gaHRtbC5tYXRjaCgvInRpdGxlIlxzKjpccyoiKCg/OlteIlxcXXxcXC4pKikiLyk7CiAgICBpZiAobSkgb3V0LnRpdGxlID0gY2xlYW5UZXh0KG1bMV0pOwogIH0KICBpZiAoIW91dC5kZXNjKSB7CiAgICBjb25zdCBtID0gaHRtbC5tYXRjaCgvImRlc2MiXHMqOlxzKiIoKD86W14iXFxdfFxcLikqKSIvKTsKICAgIGlmIChtKSBvdXQuZGVzYyA9IGNsZWFuVGV4dChtWzFdKTsKICB9CiAgaWYgKCFvdXQuYXV0aG9yKSB7CiAgICBjb25zdCBtID0gaHRtbC5tYXRjaCgvIm5pY2tOYW1lIlxzKjpccyoiKCg/OlteIlxcXXxcXC4pKikiLyk7CiAgICBpZiAobSkgb3V0LmF1dGhvciA9IGNsZWFuVGV4dChtWzFdKTsKICB9CiAgaWYgKCFvdXQuaW1hZ2VzLmxlbmd0aCkgewogICAgY29uc3QgdXJscyA9IFtdOwogICAgY29uc3QgcmUgPSAvInVybCJccyo6XHMqIihodHRwW14iXSo/c25zLSg/OndlYnBpY3xpbWcpW14iXSopIi9nOwogICAgbGV0IG1tOwogICAgd2hpbGUgKChtbSA9IHJlLmV4ZWMoaHRtbCkpICE9PSBudWxsKSB7CiAgICAgIGNvbnN0IHUgPSB1bmVzY2FwZUpzb24obW1bMV0pOwogICAgICBpZiAoIS9eaHR0cHM/OlwvXC8vLnRlc3QodSkpIGNvbnRpbnVlOwogICAgICBpZiAoL1wvKGF2YXRhcnxsb2dvKVwvL2kudGVzdCh1KSkgY29udGludWU7CiAgICAgIHVybHMucHVzaCh1KTsKICAgIH0KICAgIGNvbnN0IHNlZW4gPSB7fTsKICAgIGZvciAoY29uc3QgdSBvZiB1cmxzKSB7CiAgICAgIGNvbnN0IGtleSA9ICh1Lm1hdGNoKC8xMDQwZ1swLTlhLXpdKy9pKSB8fCBbdV0pWzBdOwogICAgICBpZiAoc2VlbltrZXldKSB7CiAgICAgICAgaWYgKC9oNV8xMDgwfEg1X0RUTC9pLnRlc3QodSkgJiYgIS9oNV8xMDgwfEg1X0RUTC9pLnRlc3Qoc2VlbltrZXldKSkgc2VlbltrZXldID0gdTsKICAgICAgICBjb250aW51ZTsKICAgICAgfQogICAgICBzZWVuW2tleV0gPSB1OwogICAgICBpZiAodXJscy5sZW5ndGggPiA2MCkgYnJlYWs7CiAgICB9CiAgICBvdXQuaW1hZ2VzID0gT2JqZWN0LnZhbHVlcyhzZWVuKS5zbGljZSgwLCBNQVhfSU1BR0VTKS5tYXAodG9IdHRwcyk7CiAgfQogIGlmIChvdXQubGlrZWRDb3VudCA9PSBudWxsICYmIG91dC5jb21tZW50Q291bnQgPT0gbnVsbCkgewogICAgY29uc3QgaWkgPSBncmFiSnNvbihodG1sLCAnaW50ZXJhY3RJbmZvJyk7CiAgICBpZiAoaWkpIHsKICAgICAgb3V0Lmxpa2VkQ291bnQgPSB0b0ludChpaS5saWtlZENvdW50KTsKICAgICAgb3V0LmNvbGxlY3RlZENvdW50ID0gdG9JbnQoaWkuY29sbGVjdGVkQ291bnQpOwogICAgICBvdXQuY29tbWVudENvdW50ID0gdG9JbnQoaWkuY29tbWVudENvdW50KTsKICAgICAgb3V0LnNoYXJlQ291bnQgPSB0b0ludChpaS5zaGFyZUNvdW50KTsKICAgIH0KICB9CiAgaWYgKCFvdXQudGFncy5sZW5ndGgpIHsKICAgIGNvbnN0IHRsID0gZ3JhYkpzb24oaHRtbCwgJ3RhZ0xpc3QnKTsKICAgIGlmIChBcnJheS5pc0FycmF5KHRsKSkgb3V0LnRhZ3MgPSB0bC5tYXAoKHQpID0+IGNsZWFuVGV4dCgodCAmJiB0Lm5hbWUpIHx8ICcnKSkuZmlsdGVyKEJvb2xlYW4pOwogIH0KICBpZiAoIW91dC5wdWJsaXNoVGltZSkgewogICAgY29uc3QgdG0gPSBodG1sLm1hdGNoKC8iYXRVc2VyTGlzdCJccyo6XHMqXFtccypcXVxzKixccyoidGltZSJccyo6XHMqKFxkezEzfSkvKTsKICAgIGNvbnN0IHRtMiA9IHRtIHx8IGh0bWwubWF0Y2goLyJ0aW1lIlxzKjpccyooXGR7MTN9KS8pOwogICAgaWYgKHRtMikgb3V0LnB1Ymxpc2hUaW1lID0gTnVtYmVyKHRtMlsxXSk7CiAgfQogIGlmICghb3V0LmNvbW1lbnRzLmxlbmd0aCkgewogICAgY29uc3QgY2QgPSBncmFiSnNvbihodG1sLCAnY29tbWVudERhdGEnKTsKICAgIGlmIChjZCAmJiBBcnJheS5pc0FycmF5KGNkLmNvbW1lbnRzKSkgewogICAgICBvdXQuY29tbWVudENvdW50ID0gb3V0LmNvbW1lbnRDb3VudCAhPSBudWxsID8gb3V0LmNvbW1lbnRDb3VudCA6IHRvSW50KGNkLmNvbW1lbnRDb3VudCk7CiAgICAgIG91dC5jb21tZW50c0hhc01vcmUgPSAhIWNkLmhhc01vcmU7CiAgICB9CiAgfQogIGlmIChjZGF0YSkgewogICAgaWYgKG91dC5jb21tZW50Q291bnQgPT0gbnVsbCkgb3V0LmNvbW1lbnRDb3VudCA9IHRvSW50KGNkYXRhLmNvbW1lbnRDb3VudCk7CiAgICBvdXQuY29tbWVudHNIYXNNb3JlID0gISFjZGF0YS5oYXNNb3JlOwogICAgb3V0LmNvbW1lbnRzID0gKGNkYXRhLmNvbW1lbnRzIHx8IFtdKS5tYXAobWFwQ29tbWVudCkuZmlsdGVyKEJvb2xlYW4pLnNsaWNlKDAsIE1BWF9DT01NRU5UUyk7CiAgfSBlbHNlIGlmICghb3V0LmNvbW1lbnRzLmxlbmd0aCkgewogICAgY29uc3QgY2QgPSBncmFiSnNvbihodG1sLCAnY29tbWVudERhdGEnKTsKICAgIGlmIChjZCAmJiBBcnJheS5pc0FycmF5KGNkLmNvbW1lbnRzKSkgewogICAgICBvdXQuY29tbWVudHMgPSBjZC5jb21tZW50cy5tYXAobWFwQ29tbWVudCkuZmlsdGVyKEJvb2xlYW4pLnNsaWNlKDAsIE1BWF9DT01NRU5UUyk7CiAgICAgIG91dC5jb21tZW50c0hhc01vcmUgPSAhIWNkLmhhc01vcmU7CiAgICB9CiAgfQoKICByZXR1cm4gb3V0Owp9CgovKiog6YCa55So572R6aG16Kej5p6Q77yab2cgLyB0d2l0dGVyIC8gdGl0bGUgLyDpppblm74gKi8KZnVuY3Rpb24gcGFyc2VHZW5lcmljKGh0bWwsIGZpbmFsVXJsKSB7CiAgY29uc3Qgb3V0ID0geyB0aXRsZTogJycsIGRlc2M6ICcnLCBhdXRob3I6ICcnLCBpbWFnZXM6IFtdIH07CiAgb3V0LnRpdGxlID0gbWV0YVRhZyhodG1sLCAnb2c6dGl0bGUnKSB8fCBtZXRhVGFnKGh0bWwsICd0d2l0dGVyOnRpdGxlJyk7CiAgb3V0LmRlc2MgPSBtZXRhVGFnKGh0bWwsICdvZzpkZXNjcmlwdGlvbicpIHx8IG1ldGFUYWcoaHRtbCwgJ2Rlc2NyaXB0aW9uJykgfHwgbWV0YVRhZyhodG1sLCAndHdpdHRlcjpkZXNjcmlwdGlvbicpOwogIGNvbnN0IG9nSW1nID0gbWV0YVRhZyhodG1sLCAnb2c6aW1hZ2UnKSB8fCBtZXRhVGFnKGh0bWwsICd0d2l0dGVyOmltYWdlJyk7CiAgaWYgKCFvdXQudGl0bGUpIHsKICAgIGNvbnN0IHQgPSBodG1sLm1hdGNoKC88dGl0bGVbXj5dKj4oW1xzXFNdKj8pPFwvdGl0bGU+L2kpOwogICAgaWYgKHQpIG91dC50aXRsZSA9IGNsZWFuVGV4dCh0WzFdKTsKICB9CiAgaWYgKG9nSW1nKSBvdXQuaW1hZ2VzLnB1c2godW5lc2NhcGVKc29uKG9nSW1nKSk7CiAgcmV0dXJuIG91dDsKfQoKLy8gLS0tLS0tLS0tLS0tLS0tLSBYIC8gVHdpdHRlciAtLS0tLS0tLS0tLS0tLS0tCi8qKiDku47ku7vmhI8geC5jb20gLyB0d2l0dGVyLmNvbSDpk77mjqXph4zlj5bmjqjmlocgaWQgKi8KZnVuY3Rpb24gdHdlZXRJZE9mKHVybCkgewogIGNvbnN0IG0gPSBTdHJpbmcodXJsIHx8ICcnKS5tYXRjaCgvKD86XnxcL1wvKSg/Ond3d1wufG1vYmlsZVwuKT8oPzp4fHR3aXR0ZXIpXC5jb21cL1teLz8jXStcL3N0YXR1cyg/OmVzKT9cLyhcZCspL2kpOwogIHJldHVybiBtID8gbVsxXSA6ICcnOwp9CgovKioKICog5o6o5paH6Kej5p6Q77ya5LyY5YWI5a6Y5pa55YWN6Ym05p2D5o6l5Y+jIGNkbi5zeW5kaWNhdGlvbi50d2ltZy5jb23vvIjog73mi7/liLDmraPmlocv5L2c6ICFL+eCuei1ni/phY3lm77vvInvvIwKICog5aSx6LSl5YaN55Sx6LCD55So5pa55Zue6YCA6aG16Z2iIG9nIOagh+etvuOAguazqOaEj++8muWig+WkluermeeCue+8jOaJi+acuumcgOiDveebtOi/niB4LmNvbSAvIHR3aW1nLmNvbeOAggogKi8KYXN5bmMgZnVuY3Rpb24gcGFyc2VUd2VldEJ5SWQoaWQpIHsKICBjb25zdCBvdXQgPSB7IHRpdGxlOiAnJywgZGVzYzogJycsIGF1dGhvcjogJycsIGltYWdlczogW10sIGxpa2VkQ291bnQ6IG51bGwsIGNvbW1lbnRDb3VudDogbnVsbCwgcHVibGlzaFRpbWU6IDAgfTsKICBpZiAoIWlkKSByZXR1cm4gb3V0OwogIGNvbnN0IHIgPSBhd2FpdCBmZXRjaEZvbGxvdygnaHR0cHM6Ly9jZG4uc3luZGljYXRpb24udHdpbWcuY29tL3R3ZWV0LXJlc3VsdD9pZD0nICsgaWQgKyAnJnRva2VuPXgmbGFuZz16aCcpOwogIGNvbnN0IGogPSBKU09OLnBhcnNlKHIuYm9keSB8fCAne30nKTsKICBpZiAoIWogfHwgIWoudGV4dCkgcmV0dXJuIG91dDsKICBvdXQuZGVzYyA9IHRpZHlUZXh0KGoudGV4dCwgdHJ1ZSk7CiAgb3V0LnRpdGxlID0gb3V0LmRlc2Muc3BsaXQoJ1xuJykuZmlsdGVyKEJvb2xlYW4pWzBdIHx8IG91dC5kZXNjOwogIGlmIChvdXQudGl0bGUubGVuZ3RoID4gODApIG91dC50aXRsZSA9IG91dC50aXRsZS5zbGljZSgwLCA4MCkgKyAn4oCmJzsKICBpZiAoai51c2VyKSB7CiAgICBvdXQuYXV0aG9yID0gKGoudXNlci5uYW1lIHx8ICcnKSArIChqLnVzZXIuc2NyZWVuX25hbWUgPyAnIEAnICsgai51c2VyLnNjcmVlbl9uYW1lIDogJycpOwogIH0KICBvdXQubGlrZWRDb3VudCA9IHRvSW50KGouZmF2b3JpdGVfY291bnQpOwogIG91dC5jb21tZW50Q291bnQgPSB0b0ludChqLmNvbnZlcnNhdGlvbl9jb3VudCk7CiAgb3V0LnB1Ymxpc2hUaW1lID0gai5jcmVhdGVkX2F0ID8gKERhdGUucGFyc2Uoai5jcmVhdGVkX2F0KSB8fCAwKSA6IDA7CiAgY29uc3QgaW1ncyA9IFtdOwogIChqLnBob3RvcyB8fCBbXSkuZm9yRWFjaCgocCkgPT4geyBpZiAocCAmJiBwLnVybCkgaW1ncy5wdXNoKHRvSHR0cHMocC51cmwpKTsgfSk7CiAgKGoubWVkaWFEZXRhaWxzIHx8IFtdKS5mb3JFYWNoKChtbSkgPT4gewogICAgaWYgKG1tICYmIG1tLm1lZGlhX3VybF9odHRwcyAmJiAoIW1tLnR5cGUgfHwgbW0udHlwZSA9PT0gJ3Bob3RvJykpIGltZ3MucHVzaCh0b0h0dHBzKG1tLm1lZGlhX3VybF9odHRwcykpOwogIH0pOwogIG91dC5pbWFnZXMgPSBpbWdzLmZpbHRlcigodSwgaSkgPT4gdSAmJiBpbWdzLmluZGV4T2YodSkgPT09IGkpLnNsaWNlKDAsIE1BWF9JTUFHRVMpOwogIHJldHVybiBvdXQ7Cn0KCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkTWV0YSh0YXJnZXQpIHsKICAvLyBYL1R3aXR0ZXIg5o6o5paH77ya5YWI6LWw5a6Y5pa55YWN6Ym05p2D5o6l5Y+j77yIeC5jb20g6aG16Z2i5pys6Lqr5pivIEpTIOa4suafkyArIOWig+WkluermeeCue+8jOS8mOWFiOi/meadoeabtOeos++8iQogIGNvbnN0IHR3ZWV0SWQgPSB0d2VldElkT2YodGFyZ2V0KTsKICBpZiAodHdlZXRJZCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgdCA9IGF3YWl0IHBhcnNlVHdlZXRCeUlkKHR3ZWV0SWQpOwogICAgICBpZiAodCAmJiB0LmRlc2MpIHsKICAgICAgICByZXR1cm4gewogICAgICAgICAgb2s6IHRydWUsCiAgICAgICAgICBmaW5hbFVybDogdGFyZ2V0LAogICAgICAgICAgc2l0ZTogJ1jvvIjmjqjnibnvvIknLAogICAgICAgICAga2luZDogJ3R3ZWV0JywKICAgICAgICAgIHRpdGxlOiB0LnRpdGxlIHx8IHQuZGVzYy5zbGljZSgwLCA4MCksCiAgICAgICAgICBkZXNjOiB0LmRlc2MsCiAgICAgICAgICBhdXRob3I6IHQuYXV0aG9yIHx8ICcnLAogICAgICAgICAgaW1hZ2VzOiB0LmltYWdlcyB8fCBbXSwKICAgICAgICAgIGxpa2VkQ291bnQ6IHQubGlrZWRDb3VudCwKICAgICAgICAgIGNvbW1lbnRDb3VudDogdC5jb21tZW50Q291bnQsCiAgICAgICAgICBwdWJsaXNoVGltZTogdC5wdWJsaXNoVGltZSB8fCAwLAogICAgICAgICAgdHdlZXRJZDogdHdlZXRJZAogICAgICAgIH07CiAgICAgIH0KICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgLy8g5o6l5Y+j5LiN6YCa77yI5aKD5aSW572R57uc77yJ4oaSIOe7p+e7rei1sOmAmueUqOmhtemdouino+aekAogICAgfQogIH0KCiAgY29uc3QgciA9IGF3YWl0IGZldGNoRm9sbG93KHRhcmdldCk7CiAgY29uc3QgaHRtbCA9IHIuYm9keSB8fCAnJzsKICBjb25zdCBmaW5hbFVybCA9IHIuZmluYWxVcmw7CiAgY29uc3Qgc2l0ZSA9IHNpdGVPZihmaW5hbFVybCkgfHwgc2l0ZU9mKHRhcmdldCk7CiAgY29uc3QgaXNYaHMgPSAveGlhb2hvbmdzaHVcLmNvbXx4aHNsaW5rXC5jbi9pLnRlc3QoZmluYWxVcmwpOwogIGNvbnN0IGlzWGhzTm90ZSA9IC94aWFvaG9uZ3NodVwuY29tXC8oZGlzY292ZXJ5XC9pdGVtfGV4cGxvcmUpXC8vaS50ZXN0KGZpbmFsVXJsKTsKICBjb25zdCBpc1R3ZWV0ID0gISF0d2VldElkT2YoZmluYWxVcmwpIHx8ICEhdHdlZXRJZE9mKHRhcmdldCk7CgogIGxldCBwYXJzZWQ7CiAgbGV0IGtpbmQgPSAnd2ViJzsKICBpZiAoaXNYaHMgJiYgaXNYaHNOb3RlKSB7CiAgICBwYXJzZWQgPSBwYXJzZVhoc05vdGUoaHRtbCk7CiAgICBraW5kID0gJ3hocy1ub3RlJzsKICB9IGVsc2UgaWYgKGlzVHdlZXQpIHsKICAgIHBhcnNlZCA9IHBhcnNlR2VuZXJpYyhodG1sLCBmaW5hbFVybCk7CiAgICBraW5kID0gJ3R3ZWV0JzsKICB9IGVsc2UgewogICAgcGFyc2VkID0gcGFyc2VHZW5lcmljKGh0bWwsIGZpbmFsVXJsKTsKICAgIGtpbmQgPSBpc1hocyA/ICd4aHMtcHJvZmlsZScgOiAnd2ViJzsKICB9CiAgLy8g5bCP57qi5Lmm5Li76aG16KGl5YWF77yaZGVzY3JpcHRpb24g6YeM6YCa5bi45pyJ57KJ5LidL+WFs+azqOS/oeaBrwogIGlmIChraW5kID09PSAneGhzLXByb2ZpbGUnICYmICFwYXJzZWQuZGVzYykgcGFyc2VkLmRlc2MgPSBtZXRhVGFnKGh0bWwsICdkZXNjcmlwdGlvbicpOwoKICBjb25zdCBtZXRhID0gewogICAgb2s6IHRydWUsCiAgICBmaW5hbFVybCwKICAgIHNpdGUsCiAgICBraW5kLAogICAgdGl0bGU6IHBhcnNlZC50aXRsZSB8fCBzaXRlIHx8IGZpbmFsVXJsLAogICAgZGVzYzogcGFyc2VkLmRlc2MgfHwgJycsCiAgICBhdXRob3I6IHBhcnNlZC5hdXRob3IgfHwgJycsCiAgICBpbWFnZXM6IHBhcnNlZC5pbWFnZXMgfHwgW10KICB9OwogIC8vIOWwj+e6ouS5pueslOiusOmZhOW4puWFqOmHj+S6kuWKqC/or4Torrrkv6Hmga/vvIjpnZ7nrJTorrDnsbvkuI3ov5Tlm57vvIzkv53mjIHpgJrnlKjnu5PmnoTlubLlh4DvvIkKICBpZiAoa2luZCA9PT0gJ3hocy1ub3RlJykgewogICAgbWV0YS5saWtlZENvdW50ID0gcGFyc2VkLmxpa2VkQ291bnQ7CiAgICBtZXRhLmNvbGxlY3RlZENvdW50ID0gcGFyc2VkLmNvbGxlY3RlZENvdW50OwogICAgbWV0YS5jb21tZW50Q291bnQgPSBwYXJzZWQuY29tbWVudENvdW50OwogICAgbWV0YS5zaGFyZUNvdW50ID0gcGFyc2VkLnNoYXJlQ291bnQ7CiAgICBtZXRhLnB1Ymxpc2hUaW1lID0gcGFyc2VkLnB1Ymxpc2hUaW1lIHx8IDA7CiAgICBtZXRhLnRhZ3MgPSBwYXJzZWQudGFncyB8fCBbXTsKICAgIG1ldGEubm90ZUlkID0gcGFyc2VkLm5vdGVJZCB8fCAnJzsKICAgIG1ldGEuY29tbWVudHMgPSBwYXJzZWQuY29tbWVudHMgfHwgW107CiAgICBtZXRhLmNvbW1lbnRzSGFzTW9yZSA9ICEhcGFyc2VkLmNvbW1lbnRzSGFzTW9yZTsKICB9CiAgLy8g5o6o5paH77ya6aG16Z2iIG9nIOWbnumAgOaXtuS5n+iDveW4puS4iuaOqOaWhyBpZO+8jOS+m+WNoeeJh+aYvuekugogIGlmIChraW5kID09PSAndHdlZXQnKSBtZXRhLnR3ZWV0SWQgPSB0d2VldElkT2YoZmluYWxVcmwpIHx8IHR3ZWV0SWRPZih0YXJnZXQpIHx8ICcnOwogIHJldHVybiBtZXRhOwp9CgovLyAtLS0tIOWbvueJh+S7o+eQhu+8muWGheWtmOWwj+e8k+WtmO+8jOmBv+WFjeWQjOS4gOW4luWkmuWbvuiiq+WPjeWkjeS4i+i9vSAtLS0tCmNvbnN0IGltZ0NhY2hlID0gbmV3IE1hcCgpOwpjb25zdCBJTUdfQ0FDSEVfVFRMID0gMTAgKiA2MCAqIDEwMDA7CmNvbnN0IElNR19DQUNIRV9NQVggPSA0MDsKCmZ1bmN0aW9uIGNhY2hlR2V0KGtleSkgewogIGNvbnN0IGhpdCA9IGltZ0NhY2hlLmdldChrZXkpOwogIGlmICghaGl0KSByZXR1cm4gbnVsbDsKICBpZiAoRGF0ZS5ub3coKSAtIGhpdC5hdCA+IElNR19DQUNIRV9UVEwpIHsgaW1nQ2FjaGUuZGVsZXRlKGtleSk7IHJldHVybiBudWxsOyB9CiAgcmV0dXJuIGhpdDsKfQoKZnVuY3Rpb24gY2FjaGVTZXQoa2V5LCB0eXBlLCBidWYpIHsKICBpZiAoaW1nQ2FjaGUuc2l6ZSA+PSBJTUdfQ0FDSEVfTUFYKSB7CiAgICBjb25zdCBmaXJzdCA9IGltZ0NhY2hlLmtleXMoKS5uZXh0KCk7CiAgICBpZiAoIWZpcnN0LmRvbmUpIGltZ0NhY2hlLmRlbGV0ZShmaXJzdC52YWx1ZSk7CiAgfQogIGltZ0NhY2hlLnNldChrZXksIHsgYXQ6IERhdGUubm93KCksIHR5cGUsIGJ1ZiB9KTsKfQoKY29uc3Qgc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIoKHJlcSwgcmVzKSA9PiB7CiAgY29ycyhyZXMpOwogIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHsgcmVzLndyaXRlSGVhZCgyMDQpOyByZXMuZW5kKCk7IHJldHVybjsgfQogIGNvbnN0IHUgPSBuZXcgVVJMKHJlcS51cmwgfHwgJy8nLCAnaHR0cDovLzEyNy4wLjAuMScpOwogIGlmICh1LnBhdGhuYW1lID09PSAnL2hlYWx0aCcpIHsKICAgIHJldHVybiBzZW5kSnNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgc2VydmljZTogJ2xpbmstbWV0YScsIHBvcnQ6IFBPUlQgfSk7CiAgfQogIGlmICh1LnBhdGhuYW1lID09PSAnL2ltZycpIHsKICAgIGNvbnN0IHRhcmdldCA9IHUuc2VhcmNoUGFyYW1zLmdldCgndXJsJykgfHwgJyc7CiAgICBpZiAoIS9eaHR0cHM/OlwvXC8vaS50ZXN0KHRhcmdldCkpIHJldHVybiBzZW5kSnNvbihyZXMsIDQwMCwgeyBvazogZmFsc2UsIGVycm9yOiAnbWlzc2luZyBvciBpbnZhbGlkIHVybCcgfSk7CiAgICBjb25zdCBjYWNoZWQgPSBjYWNoZUdldCh0YXJnZXQpOwogICAgaWYgKGNhY2hlZCkgewogICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogY2FjaGVkLnR5cGUsICdDYWNoZS1Db250cm9sJzogJ3B1YmxpYywgbWF4LWFnZT02MDAnLCAnQ29udGVudC1MZW5ndGgnOiBjYWNoZWQuYnVmLmxlbmd0aCB9KTsKICAgICAgcmV0dXJuIHJlcy5lbmQoY2FjaGVkLmJ1Zik7CiAgICB9CiAgICByZXR1cm4gZmV0Y2hJbWFnZSh0YXJnZXQpLnRoZW4oKHIpID0+IHsKICAgICAgY2FjaGVTZXQodGFyZ2V0LCByLnR5cGUsIHIuYnVmKTsKICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6IHIudHlwZSwgJ0NhY2hlLUNvbnRyb2wnOiAncHVibGljLCBtYXgtYWdlPTYwMCcsICdDb250ZW50LUxlbmd0aCc6IHIuYnVmLmxlbmd0aCB9KTsKICAgICAgcmVzLmVuZChyLmJ1Zik7CiAgICB9KS5jYXRjaCgoZSkgPT4gc2VuZEpzb24ocmVzLCA1MDIsIHsgb2s6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIHx8ICdpbWFnZSBmZXRjaCBmYWlsZWQnIH0pKTsKICB9CiAgaWYgKHUucGF0aG5hbWUgPT09ICcvcmF3JykgewogICAgLy8g5Y6f5aeL6aG16Z2i5Luj55CG77ya57uZ5bel5L2c5Y+wIGZldGNoX3VybCDlgZrjgIzmipPmraPmlofjgI3lhZzlupXvvIjov5Tlm57lrozmlbQgSFRNTO+8jOiAjOmdnuino+aekOWQjueahCBtZXRh77yJCiAgICBjb25zdCB0YXJnZXQgPSB1LnNlYXJjaFBhcmFtcy5nZXQoJ3VybCcpIHx8ICcnOwogICAgaWYgKCEvXmh0dHBzPzpcL1wvL2kudGVzdCh0YXJnZXQpKSByZXR1cm4gc2VuZEpzb24ocmVzLCA0MDAsIHsgb2s6IGZhbHNlLCBlcnJvcjogJ21pc3Npbmcgb3IgaW52YWxpZCB1cmwnIH0pOwogICAgcmV0dXJuIGZldGNoRm9sbG93KHRhcmdldCkudGhlbigocikgPT4gewogICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ3RleHQvaHRtbDsgY2hhcnNldD11dGYtOCcgfSk7CiAgICAgIHJlcy5lbmQoci5ib2R5IHx8ICcnKTsKICAgIH0pLmNhdGNoKChlKSA9PiBzZW5kSnNvbihyZXMsIDUwMiwgeyBvazogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfHwgJ2ZldGNoIGZhaWxlZCcgfSkpOwogIH0KICBpZiAodS5wYXRobmFtZSAhPT0gJy9tZXRhJykgewogICAgcmV0dXJuIHNlbmRKc29uKHJlcywgNDA0LCB7IG9rOiBmYWxzZSwgZXJyb3I6ICdub3QgZm91bmQnLCB1c2FnZTogJy9tZXRhP3VybD1odHRwczovL3hoc2xpbmsuY24vby94eHh4JyB9KTsKICB9CiAgY29uc3QgdGFyZ2V0ID0gdS5zZWFyY2hQYXJhbXMuZ2V0KCd1cmwnKSB8fCAnJzsKICBpZiAoIS9eaHR0cHM/OlwvXC8vaS50ZXN0KHRhcmdldCkpIHsKICAgIHJldHVybiBzZW5kSnNvbihyZXMsIDQwMCwgeyBvazogZmFsc2UsIGVycm9yOiAnbWlzc2luZyBvciBpbnZhbGlkIHVybCcgfSk7CiAgfQogIGJ1aWxkTWV0YSh0YXJnZXQpLnRoZW4oKG1ldGEpID0+IHNlbmRKc29uKHJlcywgMjAwLCBtZXRhKSkuY2F0Y2goKGUpID0+IHsKICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB8fCAnZmV0Y2ggZmFpbGVkJywgZmluYWxVcmw6IHRhcmdldCwgc2l0ZTogc2l0ZU9mKHRhcmdldCkgfSk7CiAgfSk7Cn0pOwoKc2VydmVyLmxpc3RlbihQT1JULCAnMTI3LjAuMC4xJywgKCkgPT4gewogIGNvbnNvbGUubG9nKCdbbGluay1tZXRhXSBsaXN0ZW5pbmcgb24gaHR0cDovLzEyNy4wLjAuMTonICsgUE9SVCk7Cn0pOwo=";
  function getLinkMetaSource() {
    try { return decodeURIComponent(escape(atob(LINK_META_SOURCE_B64))); } catch (e) { return ""; }
  }

  var BUILTIN_SCRIPTS = [
    { id: "ncm-api", name: "网易云音乐 API", desc: "网易云登录代理 / 歌单同步 / 歌词搜索（端口 3000）", port: 3000, healthUrl: "http://localhost:3000/search?keywords=test&limit=1", termuxCmd: "NeteaseCloudMusicApi -p 3000", fileContent: "", isBuiltin: true },
    { id: "cors-proxy", name: "CORS 跨域中转", desc: "为 PWA/网页版打破跨域限制，代理任意 HTTP/HTTPS 请求（端口 3001）", port: 3001, healthUrl: "http://localhost:3001/health", termuxCmd: "node $HOME/.storyphone/cors-proxy.js", fileContent: CORS_PROXY_SOURCE, isBuiltin: true },
    { id: "cmd-runner", name: "AI 命令执行服务（工作台）", desc: "工作台 Agent 执行 termux 命令 / 自写脚本 / git 仓库操作（端口 3002）", port: 3002, healthUrl: "http://localhost:3002/health", termuxCmd: "node $HOME/.storyphone/cmd-runner.js", fileContent: CMD_RUNNER_SOURCE, isBuiltin: true },
    { id: "link-meta", name: "分享链接解析服务", desc: "解析小红书/B站等分享链接的标题/封面/摘要，供聊天分享卡片使用（端口 3003）", port: 3003, healthUrl: "http://localhost:3003/health", termuxCmd: "node $HOME/.storyphone/link-meta.js", fileContent: getLinkMetaSource(), isBuiltin: true }
  ];

  // 合并内置脚本：内置脚本始终存在（旧版 localStorage 里没有 cors-proxy 也会自动补上），
  // 用户对内置脚本的编辑会覆盖对应字段
  function loadScripts() {
    var saved = [];
    try { var raw = localStorage.getItem("local-deploy-scripts"); if (raw) saved = JSON.parse(raw) || []; } catch (e) {}
    if (!Array.isArray(saved)) saved = [];
    var byId = {};
    saved.forEach(function (s) { if (s && s.id) byId[s.id] = s; });
    var merged = BUILTIN_SCRIPTS.map(function (b) {
      var s = byId[b.id];
      return s ? Object.assign({}, b, s) : JSON.parse(JSON.stringify(b));
    });
    saved.forEach(function (s) {
      if (!s || !s.id) return;
      var isBuiltin = BUILTIN_SCRIPTS.some(function (b) { return b.id === s.id; });
      if (!isBuiltin) merged.push(s);
    });
    return merged;
  }
  // 落盘时精简：内置脚本不重复存 fileContent / isBuiltin（下次加载自动补齐）
  function saveScripts(list) {
    var slim = list.map(function (s) {
      var copy = Object.assign({}, s);
      if (copy.isBuiltin) { delete copy.fileContent; delete copy.isBuiltin; }
      return copy;
    });
    localStorage.setItem("local-deploy-scripts", JSON.stringify(slim));
  }

  var localDeploySystem = {
    _confirmOkAction: null,
    _editingIndex: null,

    // ============ 面板 HTML ============
    getPanelHTML: function () {
      return `
        <div id="settings-lv2-local-deploy" class="settings-lv2-panel" style="display:none;">
          <div class="local-deploy-intro-card">
            <div class="local-deploy-intro-title">本地部署中心</div>
            <div class="local-deploy-intro-desc">
              通过 Termux 在手机上运行本地脚本服务（网易云 API / CORS 跨域中转 / AI 命令执行服务 / 分享链接解析），App 通过 localhost 访问。
              部署引导命令已内置全部脚本内容，复制到 Termux 执行即可直接创建脚本文件，无需联网下载。
            </div>
          </div>
          <div class="form-actions" style="margin-bottom:14px;">
            <button id="btn-local-deploy-guide" class="btn btn-outline" style="flex:1;">部署引导（命令可一键复制）</button>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:800; color:var(--text-primary);">我的脚本</span>
            <button id="btn-local-deploy-add" class="btn btn-primary" style="padding:6px 12px; font-size:11px;">＋ 新增脚本</button>
          </div>
          <div id="local-deploy-scripts-list"></div>

          <div id="local-deploy-guide-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.5); z-index:300; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-main); border-radius:18px; max-width:340px; width:100%; max-height:85vh; overflow-y:auto; padding:18px;">
              <div style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:12px;">Termux 部署引导</div>
              <div id="local-deploy-guide-body" style="font-size:12px; line-height:1.8; color:var(--text-secondary);"></div>
              <div class="form-actions" style="margin-top:14px;">
                <button id="btn-local-deploy-guide-close" class="btn btn-primary" style="width:100%;">我明白了</button>
              </div>
            </div>
          </div>

          <div id="local-deploy-add-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.5); z-index:310; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-main); border-radius:18px; max-width:340px; width:100%; max-height:88vh; overflow-y:auto; padding:18px;">
              <div id="ld-modal-title" style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:12px;">新增本地脚本</div>
              <div style="display:flex; flex-direction:column; gap:10px;">
                <div><label style="font-size:11px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">脚本名称</label><input type="text" id="ld-add-name" placeholder="例如：我的本地代理" style="width:100%; height:34px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; padding:0 10px; box-sizing:border-box; background:var(--surface); color:var(--text-primary);"></div>
                <div><label style="font-size:11px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">服务端口</label><input type="number" id="ld-add-port" placeholder="3000" value="3000" style="width:100%; height:34px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; padding:0 10px; box-sizing:border-box; background:var(--surface); color:var(--text-primary);"></div>
                <div><label style="font-size:11px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">健康检查地址</label><input type="text" id="ld-add-health" placeholder="http://localhost:3000/health" style="width:100%; height:34px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; padding:0 10px; box-sizing:border-box; background:var(--surface); color:var(--text-primary);"></div>
                <div><label style="font-size:11px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">Termux 启动命令</label><input type="text" id="ld-add-cmd" placeholder="例如：node start.js" style="width:100%; height:34px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; padding:0 10px; box-sizing:border-box; background:var(--surface); color:var(--text-primary);"></div>
              </div>
              <div class="form-actions" style="margin-top:14px; display:flex; gap:8px;">
                <button id="btn-local-deploy-add-cancel" class="btn btn-outline" style="flex:1;">取消</button>
                <button id="btn-local-deploy-add-save" class="btn btn-primary" style="flex:1;">保存</button>
              </div>
            </div>
          </div>

          <div id="local-deploy-confirm-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.5); z-index:320; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-main); border-radius:18px; max-width:300px; width:100%; padding:18px;">
              <div id="local-deploy-confirm-title" style="font-size:14px; font-weight:800; color:var(--text-primary); margin-bottom:8px;">确认</div>
              <div id="local-deploy-confirm-message" style="font-size:12px; line-height:1.7; color:var(--text-secondary); margin-bottom:14px;"></div>
              <div style="display:flex; gap:8px;">
                <button id="btn-local-deploy-confirm-cancel" class="btn btn-outline" style="flex:1;">取消</button>
                <button id="btn-local-deploy-confirm-ok" class="btn btn-danger" style="flex:1;">确定</button>
              </div>
            </div>
          </div>
        </div>
      `;
    },

    // ============ 初始化 ============
    initPanel: function () {
      var self = this;
      var btnGuide = document.getElementById("btn-local-deploy-guide");
      var btnAdd = document.getElementById("btn-local-deploy-add");
      if (btnGuide) btnGuide.onclick = function () { self.showGuide(); };
      if (btnAdd) btnAdd.onclick = function () { self.openScriptModal("add"); };
      var btnClose = document.getElementById("btn-local-deploy-guide-close");
      if (btnClose) btnClose.onclick = function () { self.hideGuide(); };
      var btnAddCancel = document.getElementById("btn-local-deploy-add-cancel");
      if (btnAddCancel) btnAddCancel.onclick = function () { self.closeScriptModal(); };
      var btnAddSave = document.getElementById("btn-local-deploy-add-save");
      if (btnAddSave) btnAddSave.onclick = function () { self.saveScriptModal(); };
      var btnConfirmCancel = document.getElementById("btn-local-deploy-confirm-cancel");
      if (btnConfirmCancel) btnConfirmCancel.onclick = function () { self.closeConfirmModal(); };
      var btnConfirmOk = document.getElementById("btn-local-deploy-confirm-ok");
      if (btnConfirmOk) btnConfirmOk.onclick = function () { if (self._confirmOkAction) self._confirmOkAction(); self.closeConfirmModal(); };
      this.renderScripts();
    },

    // ============ 通用确认弹窗（替代 confirm） ============
    showConfirmModal: function (title, message, onOk) {
      var overlay = document.getElementById("local-deploy-confirm-overlay");
      if (!overlay) return;
      var titleEl = document.getElementById("local-deploy-confirm-title");
      var msgEl = document.getElementById("local-deploy-confirm-message");
      if (titleEl) titleEl.innerText = title || "确认";
      if (msgEl) msgEl.innerText = message || "";
      this._confirmOkAction = onOk || null;
      overlay.style.display = "flex";
    },
    closeConfirmModal: function () {
      var overlay = document.getElementById("local-deploy-confirm-overlay");
      if (overlay) overlay.style.display = "none";
      this._confirmOkAction = null;
    },

    // ============ 新增 / 编辑脚本（应用内卡片，替代 prompt） ============
    openScriptModal: function (mode, idx) {
      var overlay = document.getElementById("local-deploy-add-overlay");
      if (!overlay) return;
      var isEdit = mode === "edit";
      var titleEl = document.getElementById("ld-modal-title");
      if (titleEl) titleEl.innerText = isEdit ? "编辑本地脚本" : "新增本地脚本";
      var s = null;
      if (isEdit) {
        var scripts = loadScripts();
        s = scripts[idx] || null;
      }
      document.getElementById("ld-add-name").value = s ? (s.name || "") : "";
      document.getElementById("ld-add-port").value = s ? String(s.port || "") : "3000";
      document.getElementById("ld-add-health").value = s ? (s.healthUrl || "") : "";
      document.getElementById("ld-add-cmd").value = s ? (s.termuxCmd || "") : "";
      this._editingIndex = isEdit && s ? idx : null;
      overlay.style.display = "flex";
    },
    closeScriptModal: function () {
      var overlay = document.getElementById("local-deploy-add-overlay");
      if (overlay) overlay.style.display = "none";
      this._editingIndex = null;
    },
    saveScriptModal: function () {
      var name = (document.getElementById("ld-add-name").value || "").trim();
      var port = (document.getElementById("ld-add-port").value || "").trim();
      var health = (document.getElementById("ld-add-health").value || "").trim();
      var cmd = (document.getElementById("ld-add-cmd").value || "").trim();
      if (!name) { showToastSafe("请输入脚本名称"); return; }
      if (!cmd) { showToastSafe("请输入 Termux 启动命令"); return; }
      if (!health) health = "http://localhost:" + (port || "3000") + "/health";
      var scripts = loadScripts();
      if (this._editingIndex !== null && scripts[this._editingIndex]) {
        var s = scripts[this._editingIndex];
        s.name = name;
        s.port = Number(port) || 3000;
        s.healthUrl = health;
        s.termuxCmd = cmd;
      } else {
        scripts.push({
          id: "script-" + Date.now(),
          name: name,
          desc: "自定义本地脚本",
          port: Number(port) || 3000,
          healthUrl: health,
          termuxCmd: cmd,
          isBuiltin: false
        });
      }
      saveScripts(scripts);
      this.closeScriptModal();
      this.renderScripts();
      showToastSafe("已保存");
    },

    // ============ 渲染脚本卡片 ============
    renderScripts: function () {
      var listEl = document.getElementById("local-deploy-scripts-list");
      if (!listEl) return;
      var scripts = loadScripts();
      if (scripts.length === 0) {
        listEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:12px;">还没有脚本，点击上方「新增脚本」添加。</div>';
        return;
      }
      listEl.innerHTML = scripts.map(function (s, idx) { return localDeploySystem._renderCard(s, idx); }).join("");
      scripts.forEach(function (s, idx) {
        var viewBtn = document.getElementById("ld-view-" + idx);
        var editBtn = document.getElementById("ld-edit-" + idx);
        var delBtn = document.getElementById("ld-del-" + idx);
        if (viewBtn) viewBtn.onclick = function () { localDeploySystem.toggleDetail(idx); };
        if (editBtn) editBtn.onclick = function () { localDeploySystem.openScriptModal("edit", idx); };
        if (delBtn) delBtn.onclick = function () { localDeploySystem.deleteScript(idx); };
      });
    },

    _renderCard: function (s, idx) {
      var isBuiltin = !!s.isBuiltin;
      var addr = s.healthUrl || ("http://localhost:" + (s.port || "3000"));
      return '' +
        '<div class="local-deploy-card" id="ld-card-' + idx + '">' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">' +
            '<div style="font-size:13px; font-weight:800; color:var(--text-primary);">' + esc(s.name) + '</div>' +
            '<span style="font-size:10px; font-weight:700; color:' + (isBuiltin ? "#6366f1" : "#64748b") + ';">' + (isBuiltin ? "内置" : "自定义") + '</span>' +
          '</div>' +
          '<div style="font-size:11px; color:var(--text-secondary); line-height:1.6; margin-bottom:8px;">' + esc(s.desc) + '</div>' +
          '<div style="font-size:10px; color:var(--text-secondary); margin-bottom:8px; word-break:break-all;">' +
            '<b>地址：</b>' + esc(addr) +
          '</div>' +
          '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
            '<button id="ld-view-' + idx + '" class="btn btn-outline" style="flex:1; padding:6px 0; font-size:11px;">查看</button>' +
            '<button id="ld-edit-' + idx + '" class="btn btn-outline" style="flex:1; padding:6px 0; font-size:11px;">编辑</button>' +
            (isBuiltin ? '' : '<button id="ld-del-' + idx + '" class="btn btn-danger-outline" style="flex:1; padding:6px 0; font-size:11px;">删除</button>') +
          '</div>' +
          '<div id="ld-detail-' + idx + '" class="local-deploy-detail" style="display:none;">' +
            '<div class="ld-detail-row"><b>服务端口：</b>' + esc(String(s.port || "-")) + '</div>' +
            '<div class="ld-detail-row"><b>健康检查地址：</b><span style="word-break:break-all;">' + esc(addr) + '</span></div>' +
            '<div class="ld-detail-row"><b>Termux 启动命令：</b></div>' +
            '<pre class="ld-code">' + esc(s.termuxCmd || "") + '</pre>' +
            (s.fileContent
              ? '<div class="ld-detail-row"><b>脚本文件内容（与仓库 termux/ 目录保持一致）：</b></div><pre class="ld-code">' + esc(s.fileContent) + '</pre>'
              : '') +
          '</div>' +
        '</div>';
    },

    // ============ 查看：展开/收起详情面板 ============
    toggleDetail: function (idx) {
      var el = document.getElementById("ld-detail-" + idx);
      if (!el) return;
      var expanded = el.style.display === "block";
      el.style.display = expanded ? "none" : "block";
      var btn = document.getElementById("ld-view-" + idx);
      if (btn) btn.innerText = expanded ? "查看" : "收起";
    },

    // ============ 删除脚本（应用内确认，替代 confirm） ============
    deleteScript: function (idx) {
      var scripts = loadScripts();
      var s = scripts[idx];
      if (!s) return;
      if (s.isBuiltin) { showToastSafe("内置脚本不可删除"); return; }
      var self = this;
      this.showConfirmModal("删除脚本", "确定删除脚本「" + s.name + "」吗？", function () {
        var saved = [];
        try { saved = JSON.parse(localStorage.getItem("local-deploy-scripts")) || []; } catch (e) {}
        if (!Array.isArray(saved)) saved = [];
        saved = saved.filter(function (x) { return !x || x.id !== s.id; });
        localStorage.setItem("local-deploy-scripts", JSON.stringify(saved));
        self.renderScripts();
        showToastSafe("脚本已删除");
      });
    },

    // ============ 部署引导（命令内置脚本内容，heredoc 直接创建文件） ============
    buildDeployCommand: function () {
      var L = [];
      var trimSrc = function (s) { return String(s || "").replace(/^\n+/, "").replace(/\n+$/, ""); };
      L.push("mkdir -p ~/.storyphone/data ~/.storyphone/status ~/.storyphone/logs ~/.storyphone/pids");
      L.push("cat > ~/.storyphone/cors-proxy.js <<'XSH_EOF'");
      L.push(trimSrc(CORS_PROXY_SOURCE));
      L.push("XSH_EOF");
      L.push("cat > ~/.storyphone/cmd-runner.js <<'XSH_EOF'");
      L.push(trimSrc(CMD_RUNNER_SOURCE));
      L.push("XSH_EOF");
      L.push("cat > ~/.storyphone/link-meta.js <<'XSH_EOF'");
      L.push(trimSrc(getLinkMetaSource()));
      L.push("XSH_EOF");
      L.push("cat > ~/.storyphone/storyphone-services.sh <<'XSH_EOF'");
      L.push(trimSrc(SERVICES_MANAGER_SOURCE));
      L.push("XSH_EOF");
      L.push("mkdir -p $PREFIX/bin");
      L.push("cat > $PREFIX/bin/storyphone <<'XSH_EOF'");
      L.push(trimSrc(XSHISHI_LAUNCHER_SOURCE));
      L.push("XSH_EOF");
      L.push("chmod +x $PREFIX/bin/storyphone");
      L.push("chmod +x ~/.storyphone/storyphone-services.sh");
      L.push("pkg update -y");
      L.push("pkg install -y nodejs-lts");
      L.push("pkg install -y git");
      L.push("npm install -g NeteaseCloudMusicApi --registry=https://registry.npmmirror.com");
      L.push("bash ~/.storyphone/storyphone-services.sh tui");
      return L.join("\n");
    },

    // 导出内置脚本到手机公共存储（Download/Storypoem/storyphone-scripts/），Termux 一条短命令即可安装
    exportScriptsToPhone: function () {
      var bridge = window.AndroidMCP;
      if (!bridge || typeof bridge.saveLocalDeployScript !== "function") {
        showToastSafe("当前环境不支持导出，请在 APK 内使用");
        return;
      }
      var files = [
        ["cors-proxy.js", CORS_PROXY_SOURCE],
        ["cmd-runner.js", CMD_RUNNER_SOURCE],
        ["link-meta.js", getLinkMetaSource()],
        ["storyphone-services.sh", SERVICES_MANAGER_SOURCE],
        ["storyphone", XSHISHI_LAUNCHER_SOURCE]
      ];
      var ok = 0, err = "";
      files.forEach(function (f) {
        try {
          var body = String(f[1] || "").replace(/^\n+/, "").replace(/\n+$/, "");
          var r = JSON.parse(bridge.saveLocalDeployScript(f[0], body) || "{}");
          if (r && r.ok) ok++; else err = (r && r.error) || "未知错误";
        } catch (e) { err = e.message || String(e); }
      });
      var dir = "";
      try { dir = (JSON.parse(bridge.getLocalDeployScriptDir() || "{}") || {}).dir || ""; } catch (e) {}
      if (ok === files.length) {
        showToastSafe("已导出 " + ok + " 个脚本 → " + (dir || "Download/Storypoem/storyphone-scripts"));
      } else {
        showToastSafe("导出成功 " + ok + "/" + files.length + " 个" + (err ? ("，失败原因：" + err) : ""));
      }
    },

    showGuide: function () {
      var overlay = document.getElementById("local-deploy-guide-overlay");
      var body = document.getElementById("local-deploy-guide-body");
      if (!overlay || !body) return;

      var steps = [
        { title: "第 1 步：安装 Termux", desc: "务必用 F-Droid 版（Play 版已停更）：https://f-droid.org/packages/com.termux/　首次使用请先执行一次 termux-setup-storage 授权存储（否则读不到手机 Download 目录）", cmd: "termux-setup-storage" },
        { title: "第 2 步（推荐）：导出脚本到手机存储", desc: "先点下面的『导出脚本到手机存储』按钮（App 会把 4 个脚本直接写进手机 Download/Storypoem/storyphone-scripts/，不经过剪贴板，绝不会被截断），然后在 Termux 执行这条短命令安装：", cmd: "mkdir -p ~/.storyphone \"$PREFIX/bin\" && cp /sdcard/Download/Storypoem/storyphone-scripts/* ~/.storyphone/ && cp ~/.storyphone/storyphone \"$PREFIX/bin/storyphone\" && chmod +x ~/.storyphone/storyphone-services.sh \"$PREFIX/bin/storyphone\" && storyphone" },
        { title: "第 2 步（备选）：一键长命令部署", desc: "若不想用导出方式，也可复制下面整条命令到 Termux 执行（内容较长，注意别被截断）：", cmd: this.buildDeployCommand() },
        { title: "第 3 步：启动服务", desc: "在服务管理器菜单按 [1] 启动全部；或分别执行：", cmd: "bash $HOME/.storyphone/storyphone-services.sh start ncm-api\nbash $HOME/.storyphone/storyphone-services.sh start cors-proxy\nbash $HOME/.storyphone/storyphone-services.sh start cmd-runner" },
        { title: "脚本缺失 / 启动失败时", desc: "若某服务提示找不到脚本（Cannot find module），执行这条短命令即可自动补齐：优先从手机存储复制，其次从仓库下载：", cmd: "storyphone repair" },
        { title: "第 4 步：随时唤出脚本页面", desc: "退出 Termux 后再进入时，直接输入下面的命令即可再次进入脚本交互页面：", cmd: "storyphone" },
        { title: "第 5 步：保活", desc: "安装 termux-api 并开启保活：", cmd: "pkg install termux-api && termux-wake-lock" },
        { title: "第 6 步：回到 App 使用", desc: "网易云登录弹窗的 API 地址填（网页版跨域中转为 3001 端口）：", cmd: "http://localhost:3000" }
      ];

      var html = '<div style="margin-bottom:12px; display:flex; flex-direction:column; gap:8px;">' +
        '<button class="btn btn-primary" style="width:100%;padding:10px 0;font-size:12px;" id="btn-export-scripts">📥 导出脚本到手机存储（推荐，防截断）</button>' +
        '<button class="btn btn-outline" style="width:100%;padding:8px 0;font-size:11px;" id="btn-check-services">🔎 自检本地服务（3001/3002/3003 是否在跑）</button>' +
        '<button class="btn btn-outline" style="width:100%;padding:8px 0;font-size:11px;" id="btn-copy-all-cmds">＋ 一键复制全部命令</button></div>';

      steps.forEach(function (step, i) {
        html += '<div style="margin-bottom:12px;">';
        html += '<b style="color:var(--text-primary);">' + step.title + '</b><br>';
        if (step.desc) html += '<span style="color:var(--text-secondary);">' + step.desc + '</span><br>';
        if (step.cmd) {
          var isMulti = step.cmd.indexOf("\n") >= 0;
          if (isMulti) {
            html += '<pre class="ld-cmd ld-cmd-multi" data-idx="' + i + '">' + esc(step.cmd) + '</pre>';
          } else {
            html += '<code class="ld-cmd" data-idx="' + i + '" style="background:rgba(0,0,0,0.06);padding:6px 8px;border-radius:6px;display:inline-block;max-width:100%;overflow-x:auto;word-break:break-all;cursor:pointer;color:var(--text-primary);">' + esc(step.cmd) + '</code>';
          }
          html += '<span class="ld-copy-tag" data-idx="' + i + '" style="font-size:10px;color:#16a34a;margin-left:8px;cursor:pointer;display:inline-block;user-select:none;">复制</span>';
        }
        html += '</div>';
      });

      body.innerHTML = html;

      body.querySelectorAll(".ld-cmd, .ld-copy-tag").forEach(function (el) {
        el.onclick = function () {
          var i = Number(el.getAttribute("data-idx"));
          copyText(steps[i].cmd);
        };
      });

      var btnAll = document.getElementById("btn-copy-all-cmds");
      if (btnAll) {
        btnAll.onclick = function () {
          copyText(steps.map(function (s) { return s.cmd; }).filter(Boolean).join("\n\n"));
        };
      }

      var btnExport = document.getElementById("btn-export-scripts");
      if (btnExport) {
        btnExport.onclick = function () { localDeploySystem.exportScriptsToPhone(); };
      }

      // 一键自检：3001/3002/3003 三个本地服务是否在运行
      var btnCheck = document.getElementById("btn-check-services");
      if (btnCheck) {
        btnCheck.onclick = async function () {
          var items = [["cors-proxy", 3001], ["cmd-runner", 3002], ["link-meta", 3003]];
          var lines = [];
          for (var i = 0; i < items.length; i++) {
            try {
              var r = await fetch("http://127.0.0.1:" + items[i][1] + "/health");
              var j = await r.json();
              lines.push(items[i][0] + ": " + (j && j.ok ? "运行中" : "异常"));
            } catch (e) { lines.push(items[i][0] + ": 未启动"); }
          }
          showToastSafe(lines.join(" · "));
        };
      }

      overlay.style.display = "flex";
    },

    hideGuide: function () {
      var overlay = document.getElementById("local-deploy-guide-overlay");
      if (overlay) overlay.style.display = "none";
    }
  };

  window.localDeploySystem = localDeploySystem;
})();
