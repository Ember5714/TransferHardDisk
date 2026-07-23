/**
 * Transfer Hard Disk — 后端主入口
 * 支持局域网和公网访问（公网模式需配置 AUTH_USER / AUTH_PASS）
 */
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const cors = require('cors');
const config = require('./config');
const auth = require('./auth');
const userSystem = require('./users');
const repoCli = require('./repo-cli');
const discovery = require('./discovery');
const fileServer = require('./fileServer');
const wsServer = require('./wsServer');
const rateLimit = require('./rateLimit');
// const fileLock = require('./fileLock');

const app = express();
const server = http.createServer(app);

// ============ 防火墙 ============
function registerFirewall() {
  const ruleNameExe = 'TransferHardDisk';
  const ruleNamePort = 'TransferHardDisk-Port';
  try {
    // 方案 1：按可执行文件放行
    execSync(`netsh advfirewall firewall show rule name="${ruleNameExe}"`, { stdio: 'ignore' });
    console.log('[Firewall] 防火墙规则（程序）已存在');
  } catch {
    try {
      const nodeExe = process.execPath;
      execSync(`netsh advfirewall firewall add rule name="${ruleNameExe}" dir=in action=allow program="${nodeExe}" enable=yes`, { stdio: 'ignore' });
      console.log('[Firewall] 已添加防火墙入站规则（程序）');
    } catch (e) {
      console.log('[Firewall] 程序规则添加失败:', e.message);
    }
  }
  // 方案 2：按端口放行（更可靠）
  try {
    execSync(`netsh advfirewall firewall show rule name="${ruleNamePort}"`, { stdio: 'ignore' });
    console.log('[Firewall] 防火墙规则（端口）已存在');
  } catch {
    try {
      execSync(`netsh advfirewall firewall add rule name="${ruleNamePort}" dir=in action=allow protocol=TCP localport=${config.PORT} enable=yes`, { stdio: 'ignore' });
      console.log(`[Firewall] 已添加防火墙入站规则（端口 ${config.PORT}）`);
    } catch (e) {
      console.log('[Firewall] 端口规则添加失败（可能需要管理员权限）:', e.message);
    }
  }
}

// ============ 获取公网 IP（多服务回退） ============
function fetchPublicIP(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        const ip = body.trim();
        // 验证是否为合法 IP 格式
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
          resolve(ip);
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getPublicIP() {
  const services = [
    'http://ipinfo.io/ip',
    'http://icanhazip.com',
    'http://ifconfig.me/ip',
    'https://api.ipify.org',
  ];
  for (const url of services) {
    const ip = await fetchPublicIP(url);
    // 过滤 IPv4，排除 IPv6 / 非 IP 格式
    if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return ip;
  }
  return null;
}

// ============ 获取局域网 IP ============
function getLanIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// ============ 中间件 ============
app.set('trust proxy', true);
app.disable('x-powered-by');

// CORS：限制为局域网 + 本机来源
const corsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return callback(null, true);
  callback(null, false);
};
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '10gb' }));

// 全局路径参数净化：防止路径穿越（含 URL 解码，防 %2e%2e%2f 绕过）
app.use((req, res, next) => {
  const sanitize = (val) => {
    if (typeof val !== 'string') return val;
    // 先 URL 解码再检查，防止 %2e%2e%2f 等编码绕过
    let decoded;
    try { decoded = decodeURIComponent(val); } catch { decoded = val; }
    return decoded.split('/').filter(s => s && s !== '..' && s !== '.').join('/');
  };
  if (req.query && req.query.path) req.query.path = sanitize(req.query.path);
  if (req.query && req.query.dir)  req.query.dir  = sanitize(req.query.dir);
  if (req.body  && req.body.path)  req.body.path  = sanitize(req.body.path);
  if (req.body  && req.body.dir)   req.body.dir   = sanitize(req.body.dir);
  if (req.body  && req.body.filePath) req.body.filePath = sanitize(req.body.filePath);
  next();
});

// 全局认证（所有 API 和前端页面）
app.use(auth);

// ============ 认证 API ============

// 注册
app.post('/api/auth/register', async (req, res) => {
  if (!config.REGISTRATION_OPEN) {
    return res.status(403).json({ error: '注册已关闭' });
  }
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'register')) {
    return res.status(429).json({ error: '注册过于频繁，请稍后再试' });
  }
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: '密码至少 8 位' });
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: '密码必须包含字母和数字' });
  }
  const result = await userSystem.register({ email, username, password });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// 验证邮箱
app.post('/api/auth/verify', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'verify')) {
    return res.status(429).json({ error: '验证过于频繁，请稍后再试' });
  }
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: '缺少参数' });
  const result = await userSystem.verify(email, code);
  if (!result.success) {
    rateLimit.recordLoginFailure(ip);
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
});

// 重新发送验证码
app.post('/api/auth/resend', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'resend')) {
    return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });
  const result = await userSystem.resendCode(email);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  const ip = rateLimit.getIP(req);
  const delay = rateLimit.getLoginDelay(ip);
  if (delay > 0) {
    return res.status(429).json({ error: `登录失败次数过多，请 ${Math.ceil(delay / 1000)} 秒后再试` });
  }
  if (rateLimit.check(ip, 'login')) {
    return res.status(429).json({ error: '登录过于频繁，请稍后再试' });
  }
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
  const result = await userSystem.login(email, password);
  if (!result.success) {
    rateLimit.recordLoginFailure(ip);
    return res.status(401).json({ error: result.error });
  }
  rateLimit.resetLoginFailures(ip);
  res.json({ token: result.token, refreshToken: result.refreshToken, user: result.user });
});

// 刷新 Token
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: '缺少 refreshToken' });
  const result = await userSystem.refreshToken(refreshToken);
  if (!result) return res.status(401).json({ error: 'refreshToken 无效或已过期' });
  res.json(result);
});

// 登出
app.post('/api/auth/logout', async (req, res) => {
  if (req.token) await userSystem.logout(req.token);
  res.json({ success: true });
});

// 当前用户信息
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  res.json({ user: req.user });
});

// 切换公开资料开关
app.patch('/api/auth/profile', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { publicProfile } = req.body;
  const result = await userSystem.setPublicProfile(req.user.email, !!publicProfile);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// 修改密码
app.patch('/api/auth/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { code, newPassword } = req.body;
  if (!code || !newPassword) return res.status(400).json({ error: '请填写验证码和新密码' });
  const result = await userSystem.changePassword(req.user.email, code, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// 发送操作验证码（修改密码、注销账号等敏感操作）
app.post('/api/auth/send-op-code', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { operation } = req.body;
  if (!operation || !['changePassword', 'deleteAccount'].includes(operation)) {
    return res.status(400).json({ error: '无效的操作类型' });
  }
  const result = await userSystem.sendOperationCode(req.user.email, operation);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, smtpSent: result.smtpSent });
});

// 修改用户名
app.patch('/api/auth/username', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '用户名不能为空' });
  const result = await userSystem.changeUsername(req.user.email, username);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, username: result.username });
});

// 修改个性签名
app.patch('/api/auth/signature', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { signature } = req.body;
  const result = await userSystem.setSignature(req.user.email, signature || '');
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, signature: result.signature });
});

// 上传头像
const avatarUpload = fileServer.createAvatarUploadHandler();
app.post('/api/auth/avatar', avatarUpload.single('avatar'), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  if (!req.file) return res.status(400).json({ error: '请选择头像文件' });
  try {
    const avatarBuffer = await require('fs/promises').readFile(req.file.path);
    const result = await userSystem.setAvatar(req.user.email, avatarBuffer);
    // 清理临时文件
    try { await require('fs/promises').unlink(req.file.path); } catch {}
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, avatar: result.avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 注销账号
app.delete('/api/auth/account', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '请输入验证码' });
  const result = await userSystem.deleteAccount(req.user.email, code);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// 发送找回密码验证码（统一返回 success 防止邮箱枚举）
app.post('/api/auth/send-reset-code', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'resend')) {
    return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '请输入邮箱' });
  const result = await userSystem.sendResetCode(email);
  res.json({ success: true, smtpSent: result.smtpSent });
});

// 重置密码（找回密码）
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: '请填写完整信息' });
  const result = await userSystem.resetPassword(email, code, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// 搜索公开用户（按用户名）
app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const results = await userSystem.searchUsers(q);
  res.json(results);
});

// ============ WebSocket（设备发现，保留） ============
wsServer.init(server);
discovery.on('device-online', (device) => {
  wsServer.sendDeviceOnline(device);
  wsServer.sendDeviceList(discovery.getDevices());
});
discovery.on('device-offline', (device) => {
  wsServer.sendDeviceOffline(device);
  wsServer.sendDeviceList(discovery.getDevices());
});

// ============ API 路由 ============

// 本机信息
app.get('/api/self', (req, res) => {
  res.json({
    id: config.DEVICE_ID,
    name: config.DEVICE_NAME,
    port: config.PORT,
    storage: config.UPLOAD_DIR,
    authEnabled: !!(config.AUTH_USER && config.AUTH_PASS),
    network: discovery.getNetworkInfo(),
  });
});

// 诊断（需登录，仅显示本机摘要信息）
app.get('/api/diagnose', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  res.json({
    self: { name: config.DEVICE_NAME, port: config.PORT },
    wsClients: wsServer.getClientCount(),
  });
});

// 公网连通性诊断（需登录）
app.get('/api/ping', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  res.json({ ok: true, time: Date.now() });
});

// ============ 个人信息 ============

// 获取自己的个人简介
app.get('/api/auth/profile-bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const bio = await userSystem.getProfileBio(req.user.id);
  res.json({ bio });
});

// 保存自己的个人简介（在线编辑）
app.put('/api/auth/profile-bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: '缺少内容' });
  const result = await userSystem.saveProfileBio(req.user.id, content);
  res.json(result);
});

// 上传背景图
const bgUpload = fileServer.createBackgroundUploadHandler();
app.post('/api/auth/profile-background', bgUpload.single('background'), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  if (!req.file) return res.status(400).json({ error: '请选择背景图片' });
  try {
    const bgBuffer = await require('fs/promises').readFile(req.file.path);
    const result = await userSystem.setProfileBackground(req.user.email, bgBuffer);
    try { await require('fs/promises').unlink(req.file.path); } catch {}
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取他人个人简介（需登录）
app.get('/api/users/:userId/profile/bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const targetUser = await userSystem.getUserById(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在或未公开' });
  const bio = await userSystem.getProfileBio(req.params.userId);
  res.json({ bio, username: targetUser.username, avatar: targetUser.avatar });
});

// 获取他人完整个人信息（需登录）
app.get('/api/users/:userId/profile', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const targetUser = await userSystem.getUserById(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在或未公开' });
  const bio = await userSystem.getProfileBio(req.params.userId);
  res.json({
    id: targetUser.id,
    username: targetUser.username,
    avatar: targetUser.avatar,
    background: targetUser.background,
    signature: targetUser.signature || '',
    bio,
  });
});

// ============ 文件浏览（网盘核心 —— 用户隔离版本） ============

// 浏览自己的文件（用 query 参数区分私密/公开）
app.get('/api/files/browse', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  try {
    const visibility = req.query.visibility || 'private';
    if (!['private', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility 必须是 private 或 public' });
    }
    const result = await fileServer.browse(req.user.id, visibility, req.query.dir || '');
    res.json({ ...result, username: req.user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 浏览他人公开文件（需登录）
app.get('/api/users/:userId/public/browse', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const targetUser = await userSystem.getUserById(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在或未公开' });
  try {
    const result = await fileServer.browse(req.params.userId, 'public', req.query.dir || '');
    res.json({ ...result, username: targetUser.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 复制公开用户的文件到自己的私密仓库
app.post('/api/users/:userId/copytome', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: '缺少文件路径' });
  try {
    const result = await fileServer.copyFromPublic(req.params.userId, filePath, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/files/mkdir', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { dir, name, visibility } = req.body;
  if (!name) return res.status(400).json({ error: '请输入文件夹名称' });
  try {
    const result = await fileServer.mkdir(req.user.id, visibility || 'private', dir || '', name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/rename', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { path: filePath, name, visibility } = req.body;
  if (!filePath || !name) return res.status(400).json({ error: '缺少参数' });
  try {
    const result = await fileServer.rename(req.user.id, visibility || 'private', filePath, name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const { path: filePath, visibility } = req.body;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  try {
    await fileServer.delete(req.user.id, visibility || 'private', filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下载自己的文件
app.get('/api/files/download', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const filePath = req.query.path;
  const visibility = req.query.visibility || 'private';
  if (!filePath) return res.status(400).json({ error: '缺少文件路径' });
  try {
    const download = fileServer.createDownloadStream(req.user.id, visibility, filePath, req.headers.range);
    res.set(download.headers);
    res.status(download.statusCode);
    download.stream.pipe(res);
    download.stream.on('error', (err) => {
      console.error('[Download] error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// 下载他人公开文件（需登录）
app.get('/api/users/:userId/public/download', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const targetUser = await userSystem.getUserById(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在或未公开' });
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少文件路径' });
  try {
    const download = fileServer.createDownloadStream(req.params.userId, 'public', filePath, req.headers.range);
    res.set(download.headers);
    res.status(download.statusCode);
    download.stream.pipe(res);
    download.stream.on('error', (err) => {
      console.error('[Download] error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// 加密下载自己的文件（压缩+AES加密，密钥先于文件体发送）
app.get('/api/files/download-encrypted', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const filePath = req.query.path;
  const visibility = req.query.visibility || 'private';
  if (!filePath) return res.status(400).json({ error: '缺少文件路径' });
  try {
    const download = fileServer.createEncryptedDownloadStream(req.user.id, visibility, filePath);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      'X-Enc-Key': download.keyB64,
      'X-Enc-IV': download.ivB64,
      'X-Enc-Original-Name': encodeURIComponent(download.fileName),
    });
    download.stream.pipe(res);
    download.stream.on('error', (err) => {
      console.error('[EncDownload] error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// 加密下载他人公开文件（需登录）
app.get('/api/users/:userId/public/download-encrypted', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const targetUser = await userSystem.getUserById(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在或未公开' });
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少文件路径' });
  try {
    const download = fileServer.createEncryptedDownloadStream(req.params.userId, 'public', filePath);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      'X-Enc-Key': download.keyB64,
      'X-Enc-IV': download.ivB64,
      'X-Enc-Original-Name': encodeURIComponent(download.fileName),
    });
    download.stream.pipe(res);
    download.stream.on('error', (err) => {
      console.error('[EncDownload] error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ============ 上传冷却计时
const UPLOAD_COOLDOWN = 60 * 1000; // 60 秒
const lastUploadTime = new Map(); // userId -> timestamp

const upload = fileServer.createUploadHandler();
app.post('/api/files/upload', upload.array('files', config.MAX_FILE_COUNT), (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });

  // 上传冷却检查
  const now = Date.now();
  const lastTime = lastUploadTime.get(req.user.id) || 0;
  const remaining = Math.ceil((UPLOAD_COOLDOWN - (now - lastTime)) / 1000);
  if (remaining > 0) {
    return res.status(429).json({
      error: `上传冷却中，请 ${remaining} 秒后再试`,
      remaining,
    });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有选择文件' });
  }
  const files = req.files.map((f) => ({
    name: f.originalname, savedName: f.filename, path: f.path, size: f.size,
  }));
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  console.log(`[Upload] ${req.user.username} 上传 ${files.length} 个文件 (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
  wsServer.sendFileReceived({ name: `${files.length} 个文件`, size: totalSize });

  // 记录本次上传时间
  lastUploadTime.set(req.user.id, now);

  res.json({ success: true, files });
});

// multer 错误处理
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: `单次最多上传 ${config.MAX_FILE_COUNT} 个文件，请分批上传或使用 zip 打包` });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `单个文件超过大小限制 ${(parseInt(config.MAX_FILE_SIZE) / 1024 / 1024).toFixed(0)} MB` });
  }
  if (err.code === 'LIMIT_FIELD_SIZE') {
    return res.status(413).json({ error: '文件名总长度超过限制，请分批上传' });
  }
  console.error('[Multer]', err.message);
  res.status(500).json({ error: err.message || '上传失败' });
});

// ============ 静态文件（前端） ============
const clientDist = path.join(config.ROOT_DIR, 'client', 'dist');
const logoDir = path.join(config.ROOT_DIR, 'logo');
const avatarDir = path.join(config.ROOT_DIR, 'data', 'avatars');

if (fs.existsSync(logoDir)) {
  app.use('/logo', express.static(logoDir));
}

// 头像静态服务（无需登录，确保目录存在）
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}
app.use('/avatars', express.static(avatarDir));

// 背景图静态服务
const bgDir = path.join(config.ROOT_DIR, 'data', 'backgrounds');
if (!fs.existsSync(bgDir)) {
  fs.mkdirSync(bgDir, { recursive: true });
}
app.use('/backgrounds', express.static(bgDir));

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ============ 启动 ============
// 预先注册防火墙规则（在服务器监听之前）
registerFirewall();

// 预先获取公网 IP（并行于服务器启动）
const publicIPPromise = getPublicIP();

// 处理端口占用等错误
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${config.PORT} is already in use.`);
    console.error(`        Stop the other process or use: netstat -ano | findstr :${config.PORT}`);
    console.error(`        Then: taskkill /PID <PID> /F`);
    process.exit(1);
  } else {
    console.error('[ERROR] Server error:', err.message);
    process.exit(1);
  }
});

server.listen(config.PORT, config.BIND_ADDRESS, async () => {
  await userSystem.init();

  // 锁定仓库文件防止外部篡改（暂时禁用，ACL 修复后重新启用）
  // fileLock.init(config.ROOT_DIR);

  const lanIPs = getLanIPs();
  const publicIP = await publicIPPromise;

  console.log('========================================');
  console.log('  \\\\\\_____________\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ ');
  console.log('  \\\\\\[____/__/____]\\\\\{~}\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\%&&&&&&&&\\\\\\\\\\\\\\\\');
  console.log('  \\\\\\\\\\\\/__/\\\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\@\\\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\\');
  console.log('  \\\\\\\\\\\/__/\\\\\\\\\\\\\\\\{~}_______{~}\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\\\\');
  console.log('  \\\\\\\\\/__/\\\\\\\\\\\\\\\\\{~_________~}\\\\\\\\\\\\\\$\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\\\\\\\\');
  console.log('  \\\\\\\/__/\\\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\?\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\\\\\\\\\\');
  console.log('  \\\\\/__/\\\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\#\\\\\\\\\\\\&\\\\\\\\\\\\\\\\\\\\\\\\\\\\ ');
  console.log('  \\\/__/\\\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\{~}\\\\\\\\\\\\\\!&&&&&&7\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\');
  console.log('========================================');
  console.log(`  Device  : ${config.DEVICE_NAME}`);
  console.log(`  Bind    : ${config.BIND_ADDRESS}:${config.PORT}`);
  console.log(`  Storage : ${config.UPLOAD_DIR}`);
  console.log(`  SMTP    : ${config.SMTP_HOST ? config.SMTP_HOST + ' (configured)' : 'not configured'}`);
  console.log('========================================');
  console.log('  Access URLs:');
  console.log(`    Local  : http://localhost:${config.PORT}`);
  for (const ip of lanIPs) {
    console.log(`    LAN    : http://${ip}:${config.PORT}`);
  }
  if (publicIP) {
    console.log(`    Public : http://${publicIP}:${config.PORT}`);
  }
  console.log('========================================');
  if (!publicIP) {
    console.log('  [Note] Make sure port forwarding is configured on your router:');
    console.log(`    Port ${config.PORT} -> ${lanIPs[0] || 'your LAN IP'}`);
    console.log('========================================');
  }

  discovery.start(config.PORT);

  // 启动命令行提示
  console.log('\n  输入 help 查看可用命令\n');
  rl.prompt();
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============ 服务端命令行界面 ============
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
  terminal: true,
});

function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}, shutting down...`);
  discovery.stop();
  // fileLock.cleanup();
  server.close();
  rl.close();
  process.exit(0);
}

function printHelp() {
  console.log('');
  console.log('  可用命令:');
  console.log('    status        查看服务器状态');
  console.log('    users         查看注册用户');
  console.log('    config        查看当前配置');
  console.log('    --- 仓库浏览 ---');
  console.log('    ls [路径]     列出文件，默认根目录');
  console.log('    tree [路径]   树形展示目录结构');
  console.log('    du [路径]     统计磁盘占用');
  console.log('    info <路径>   查看文件/目录详情');
  console.log('    --- 系统 ---');
  console.log('    clear         清屏');
  console.log('    help          显示帮助');
  console.log('    stop          关闭服务器');
  console.log('    restart       重启服务器');
  console.log('');
}

function printStatus() {
  const lanIPs = getLanIPs();
  const wssCount = wsServer ? wsServer.getClientCount() : 0;
  console.log('');
  console.log('  === 服务器状态 ===');
  console.log(`  Device      : ${config.DEVICE_NAME}`);
  console.log(`  Port        : ${config.PORT}`);
  console.log(`  Storage     : ${config.UPLOAD_DIR}`);
  console.log(`  SMTP        : ${config.SMTP_HOST ? config.SMTP_HOST : '未配置'}`);
  console.log(`  WS Clients  : ${wssCount}`);
  console.log(`  Public IP   : ${getPublicIP.lastResult || 'detecting...'}`);
  console.log('  LAN IPs:');
  for (const ip of lanIPs) {
    console.log(`    http://${ip}:${config.PORT}`);
  }
  console.log('');
}

async function printUsers() {
  const users = await userSystem._loadUsers();
  const entries = Object.entries(users);
  if (entries.length === 0) {
    console.log('  暂无注册用户');
    return;
  }
  console.log('');
  console.log(`  注册用户 (${entries.length}):`);
  console.log('  ' + '-'.repeat(60));
  for (const [email, u] of entries) {
    const status = u.verified ? '✓' : '✗';
    const pub = u.publicProfile ? '公开' : '私密';
    console.log(`  ${status} ${u.username.padEnd(16)} ${email.padEnd(28)} ${pub}`);
  }
  console.log('  ' + '-'.repeat(60));
  console.log('');
}

function printConfig() {
  console.log('');
  console.log('  === 当前配置 ===');
  console.log(`  PORT               = ${config.PORT}`);
  console.log(`  DEVICE_NAME        = ${config.DEVICE_NAME}`);
  console.log(`  UPLOAD_DIR         = ${config.UPLOAD_DIR}`);
  console.log(`  MAX_FILE_SIZE      = ${config.MAX_FILE_SIZE || '不限'}`);
  console.log(`  MAX_FILE_COUNT     = ${config.MAX_FILE_COUNT} 个/次`);
  console.log(`  REGISTRATION_OPEN  = ${config.REGISTRATION_OPEN}`);
  console.log(`  SMTP_HOST          = ${config.SMTP_HOST || '未配置'}`);
  console.log(`  SMTP_PORT          = ${config.SMTP_PORT || '587'}`);
  console.log(`  SMTP_USER          = ${config.SMTP_USER || '未配置'}`);
  console.log(`  ROOT_DIR           = ${config.ROOT_DIR}`);
  console.log('');
}

rl.on('line', async (line) => {
  const cmd = line.trim();
  if (!cmd) { rl.prompt(); return; }

  // 解析命令和参数
  const cmdParts = cmd.split(/\s+/);
  const command = cmdParts[0];
  const args = cmdParts.slice(1).join(' ');

  switch (command) {
    case 'help':
      printHelp();
      break;
    case 'status':
      printStatus();
      break;
    case 'users':
      await printUsers();
      break;
    case 'config':
      printConfig();
      break;
    case 'clear':
      console.clear();
      break;
    case 'stop':
      shutdown('CLI');
      return;
    case 'restart':
      console.log('[Server] Restarting...');
      discovery.stop();
      // fileLock.cleanup();
      server.close();
      rl.close();
      const { exec } = require('child_process');
      const batPath = path.join(config.ROOT_DIR, 'start.bat');
      exec(`start "Transfer Hard Disk" cmd /c "${batPath}"`, { cwd: config.ROOT_DIR, windowsHide: false });
      setTimeout(() => process.exit(0), 500);
      return;
    case 'ls':
      repoCli.ls(args);
      break;
    case 'tree':
      console.log('');
      repoCli.tree(args);
      console.log('');
      break;
    case 'du':
      repoCli.du(args);
      break;
    case 'info':
      if (!args) { console.log('  用法: info <路径>'); break; }
      repoCli.info(args);
      break;
    default:
      console.log(`  未知命令: ${command}，输入 help 查看帮助`);
  }
  rl.prompt();
});

// 暴露 readUsers 给 CLI 使用
userSystem._loadUsers = async () => {
  const p = require('path').join(config.ROOT_DIR, 'data', 'users.json');
  try { return JSON.parse(await require('fs/promises').readFile(p, 'utf8')); }
  catch { return {}; }
};