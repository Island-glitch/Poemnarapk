/**
 * start-ncm-api.js - 一键启动本地网易云音乐 API 服务器
 *
 * 使用方法：
 *   1. 确保已安装 Node.js (v12+)
 *   2. 在项目目录运行：node start-ncm-api.js
 *   3. 看到 "NCM API 服务器已启动" 后，回到应用中即可使用网易云登录功能
 *
 * 首次运行会自动安装 NeteaseCloudMusicApi 依赖（约 10-30 秒）。
 * 之后再次启动会直接运行，无需重复安装。
 *
 * 可选环境变量：
 *   NCM_PROXY=http://127.0.0.1:18080  设置代理（内网/沙箱环境用）
 *   NCM_PORT=3000                     自定义端口
 */

const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.NCM_PORT || 3000);
const PROXY = process.env.NCM_PROXY || '';

// 检查依赖是否已安装
function isModuleInstalled() {
  try {
    require.resolve('NeteaseCloudMusicApi');
    return true;
  } catch(e) {
    return false;
  }
}

// 自动安装依赖
function installDeps() {
  console.log('[NCM API] 首次运行，正在安装 NeteaseCloudMusicApi 依赖...');
  console.log('[NCM API] 这可能需要 10-30 秒，请耐心等待...');
  try {
    execSync('npm install NeteaseCloudMusicApi', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, npm_config_progress: 'false' }
    });
    console.log('[NCM API] 依赖安装完成！');
    return true;
  } catch(e) {
    console.error('[NCM API] 依赖安装失败:', e.message);
    console.error('[NCM API] 请手动运行: npm install NeteaseCloudMusicApi');
    return false;
  }
}

// 检查端口是否被占用
function checkPort(port) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once('error', () => resolve(true));
    tester.once('listening', () => {
      tester.close();
      resolve(false);
    });
    tester.listen(port);
  });
}

async function main() {
  console.log('========================================');
  console.log('  网易云音乐 API 本地服务器');
  console.log('========================================\n');

  // 1. 检查依赖
  if (!isModuleInstalled()) {
    const ok = installDeps();
    if (!ok) process.exit(1);
  }

  // 2. 检查端口
  const portInUse = await checkPort(PORT);
  if (portInUse) {
    console.log(`[NCM API] 端口 ${PORT} 已被占用，服务器可能已经在运行。`);
    console.log(`[NCM API] 在应用中的 API 地址填写: http://localhost:${PORT}`);
    process.exit(0);
  }

  // 3. 加载模块
  console.log('[NCM API] 正在加载模块...');
  const NCM = require('NeteaseCloudMusicApi');
  console.log('[NCM API] 模块加载完成，可用函数: ' + Object.keys(NCM).length + ' 个');

  // 4. 创建自定义 HTTP 服务器
  //    自动注入 proxy 参数，让所有请求都走代理（如果配置了的话）
  const server = http.createServer(async (req, res) => {
    // CORS 头：允许浏览器跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.replace(/^\//, '');
    const query = parsedUrl.query;

    // 健康检查
    if (pathname === '' || pathname === 'health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ncm-api' }));
      return;
    }

    // 路由映射：把 /captcha/sent 转成 captcha_sent（兼容 NeteaseCloudMusicApi 的两种命名）
    const fnName = pathname.replace(/\//g, '_');
    const fn = NCM[fnName];
    if (typeof fn !== 'function') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 404, msg: `Unknown route: /${pathname}` }));
      return;
    }

    try {
      // 构造参数：合并 query 参数 + proxy
      const args = { ...query };
      if (PROXY) {
        args.proxy = PROXY;
      }

      const result = await fn(args);

      // 返回结果：body + cookie 都返回（前端需要 cookie 做后续请求）
      const responseBody = result.body || result;
      // 把 cookie 附加到响应体里，前端可以提取
      if (result.cookie && Array.isArray(result.cookie)) {
        responseBody.cookie = result.cookie;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 500, msg: e.message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`\n[NCM API] ✓ 服务器已启动！`);
    console.log(`[NCM API] API 地址: http://localhost:${PORT}`);
    console.log(`[NCM API] 在应用的"API 地址设置"中填入: http://localhost:${PORT}`);
    if (PROXY) {
      console.log(`[NCM API] 代理已启用: ${PROXY}`);
    }
    console.log(`[NCM API] 然后即可使用手机号+验证码登录网易云音乐\n`);
    console.log('[NCM API] 按 Ctrl+C 停止服务器\n');
  });
}

main();
