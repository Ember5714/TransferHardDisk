// ============ 频率限制模块 ============
// 基于 IP 的简单速率限制，防止暴力注册和登录
const rateLimit = new Map(); // ip -> { count, resetAt }

const LIMITS = {
  register:  { max: 3,  windowMs: 60 * 60 * 1000 },  // 每小时 3 次注册
  login:     { max: 10, windowMs: 15 * 60 * 1000 },  // 每 15 分钟 10 次登录
  verify:    { max: 10, windowMs: 15 * 60 * 1000 },  // 每 15 分钟 10 次验证
  resend:    { max: 5,  windowMs: 15 * 60 * 1000 },  // 每 15 分钟 5 次重发验证码
};

// 登录失败递增延迟（秒）
const loginDelays = new Map(); // ip -> { failures, until }

function getIP(req) {
  // 使用 socket 真实 IP，忽略 X-Forwarded-For 防止伪造绕过
  return req.socket.remoteAddress || '127.0.0.1';
}

function check(ip, action) {
  const limit = LIMITS[action];
  if (!limit) return true;

  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + limit.windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit.max;
}

function getLoginDelay(ip) {
  const entry = loginDelays.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.until) {
    loginDelays.delete(ip);
    return 0;
  }
  return entry.until - Date.now();
}

function recordLoginFailure(ip) {
  const entry = loginDelays.get(ip) || { failures: 0, until: 0 };
  entry.failures++;
  entry.until = Date.now() + Math.min(entry.failures * 2000, 30000); // 递增延迟，最多 30s
  loginDelays.set(ip, entry);
}

function resetLoginFailures(ip) {
  loginDelays.delete(ip);
}

// 定期清理过期条目（每 10 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimit) {
    if (now > entry.resetAt) rateLimit.delete(ip);
  }
  for (const [ip, entry] of loginDelays) {
    if (now > entry.until) loginDelays.delete(ip);
  }
}, 10 * 60 * 1000);

module.exports = { check, getLoginDelay, recordLoginFailure, resetLoginFailures, getIP };