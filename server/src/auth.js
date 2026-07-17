/**
 * Token 认证中间件
 * 从 Authorization: Bearer <token> header 或 URL query 参数中提取 token
 * 支持下载链接直接带 token: /api/files/download?path=xxx&token=xxx
 */
const users = require('./users');

// 无需登录的公开路由
const PUBLIC_PATHS = [
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/resend',
  '/api/auth/login',
  '/api/auth/send-reset-code',
  '/api/auth/reset-password',
  '/api/ping',
];

async function auth(req, res, next) {
  const path = req.path;

  // 公开路由（无需登录）
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }

  // 浏览/下载他人的公开文件（无需登录）
  if (path.match(/^\/api\/users\/[^/]+\/public\/(browse|download)$/)) {
    return next();
  }

  // 浏览他人个人信息（无需登录）
  if (path.match(/^\/api\/users\/[^/]+\/profile(\/bio)?$/)) {
    return next();
  }

  // 优先从 header 获取
  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader) {
    token = authHeader.replace('Bearer ', '');
  }
  // 如果 header 没有，从 query 参数获取（用于下载链接）
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  const user = await users.validateToken(token);
  if (user) {
    req.user = user;
    req.token = token;
    return next();
  }

  // API 调用返回 401
  if (path.startsWith('/api/')) {
    return res.status(401).json({ error: '未登录' });
  }

  // 页面请求放行，前端自己检测登录状态
  next();
}

module.exports = auth;