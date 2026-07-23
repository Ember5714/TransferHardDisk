/**
 * Token 认证中间件
 * 仅从 Authorization: Bearer <token> header 提取 token
 */
const users = require('./users');

// 无需登录的公开路由
const PUBLIC_PATHS = [
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/resend',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/send-reset-code',
  '/api/auth/reset-password',
];

async function auth(req, res, next) {
  const path = req.path;

  // 公开路由（无需登录）
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }

  // 仅从 header 获取
  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader) {
    token = authHeader.replace('Bearer ', '');
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