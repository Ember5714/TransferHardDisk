/**
 * 用户系统 — 注册 / 邮箱验证 / 登录 / Token / 账户管理
 */
const fs = require('fs/promises');
const fss = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('./config');

const DATA_FILE = path.join(config.ROOT_DIR, 'data', 'users.json');
const TOKEN_FILE = path.join(config.ROOT_DIR, 'data', 'tokens.json');
const AVATAR_DIR = path.join(config.ROOT_DIR, 'data', 'avatars');
const PROFILE_DIR = path.join(config.ROOT_DIR, 'data', 'profiles');
const BG_DIR = path.join(config.ROOT_DIR, 'data', 'backgrounds');
const SALT_LEN = 16;
const KEY_LEN = 64;

// ============ 初始化 ============
async function init() {
  const dir = path.dirname(DATA_FILE);
  try { await fs.stat(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
  // 迁移旧用户：补全 publicProfile 字段
  const users = await loadUsers();
  let migrated = false;
  for (const email of Object.keys(users)) {
    if (users[email].publicProfile === undefined) {
      users[email].publicProfile = false;
      migrated = true;
    }
  }
  if (migrated) {
    await saveUsers(users);
    console.log('[Users] 已迁移旧用户数据，补全 publicProfile 字段');
  }
}

async function loadUsers() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch { const e = {}; await fs.writeFile(DATA_FILE, JSON.stringify(e, null, 2), 'utf8'); return e; }
}

async function saveUsers(u) { await fs.writeFile(DATA_FILE, JSON.stringify(u, null, 2), 'utf8'); }

async function loadTokens() {
  try { return JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8')); }
  catch { const e = {}; await fs.writeFile(TOKEN_FILE, JSON.stringify(e, null, 2), 'utf8'); return e; }
}

async function saveTokens(t) { await fs.writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), 'utf8'); }

// ============ 密码 ============
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const v = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(v));
}

// ============ 验证码 ============
function generateCode() {
  return Math.floor(Math.random() * 900000 + 100000).toString();
}

// ============ 邮件 ============
async function sendVerificationEmail(to, code) {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    console.warn('[Email] SMTP not configured, skipping send');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: parseInt(config.SMTP_PORT || '587'),
    secure: config.SMTP_PORT === '465',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  try {
    await transport.sendMail({
      from: `"Transfer Hard Disk" <${config.SMTP_USER}>`,
      to,
      subject: 'Transfer Hard Disk 邮箱验证码',
      text: `你的验证码是：${code}\n\n验证码 10 分钟内有效，请在注册页面输入完成验证。`,
      html: `<p>你的验证码是：<strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>验证码 10 分钟内有效，请在注册页面输入完成验证。</p>`,
    });
    return true;
  } catch (err) {
    console.error('[Email] send failed:', err.message);
    return false;
  }
}

async function sendOperationEmail(to, code, operation) {
  const labels = {
    changePassword: '修改密码',
    deleteAccount: '注销账号',
    resetPassword: '重置密码',
  };
  const label = labels[operation] || '敏感操作';
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    console.warn('[Email] SMTP not configured, skipping send');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: parseInt(config.SMTP_PORT || '587'),
    secure: config.SMTP_PORT === '465',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  try {
    await transport.sendMail({
      from: `"Transfer Hard Disk" <${config.SMTP_USER}>`,
      to,
      subject: `Transfer Hard Disk - ${label}验证码`,
      text: `你的${label}验证码是：${code}\n\n验证码 10 分钟内有效。如非本人操作，请立即检查账户安全。`,
      html: `<p>你的<strong>${label}</strong>验证码是：<strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>验证码 10 分钟内有效。如非本人操作，请立即检查账户安全。</p>`,
    });
    return true;
  } catch (err) {
    console.error('[Email] operation email failed:', err.message);
    return false;
  }
}

// ============ 注册 ============
async function register({ email, username, password }) {
  const users = await loadUsers();
  if (users[email] && users[email].verified) return { error: '邮箱已被注册' };

  const passwordHash = hashPassword(password);
  const code = generateCode();
  const userId = crypto.randomUUID();

  users[email] = {
    id: userId, email, username, passwordHash,
    verified: false, code,
    publicProfile: false,   // 公开资料开关——设为 true 后他人可通过用户名搜索
    codeExpires: Date.now() + 1000 * 60 * 10,
    createdAt: Date.now(),
  };
  await saveUsers(users);

  const sent = await sendVerificationEmail(email, code);
  if (!sent) {
    console.log(`[Email] Verification code for ${email}: ${code}`);
  }
  return { success: true, email, smtpSent: sent };
}

// ============ 验证邮箱 ============
async function verify(email, code) {
  const users = await loadUsers();
  const entry = users[email];
  if (!entry) return { success: false, error: '邮箱未注册' };
  if (entry.verified) return { success: false, error: '邮箱已验证' };
  if (Date.now() > entry.codeExpires) return { success: false, error: '验证码已过期' };
  if (entry.code !== code) return { success: false, error: '验证码错误' };

  entry.verified = true;
  delete entry.code;
  delete entry.codeExpires;
  await saveUsers(users);
  return { success: true };
}

// ============ 重新发送验证码 ============
async function resendCode(email) {
  const users = await loadUsers();
  const entry = users[email];
  if (!entry) return { success: false, error: '邮箱未注册' };
  if (entry.verified) return { success: false, error: '邮箱已验证' };

  const code = generateCode();
  entry.code = code;
  entry.codeExpires = Date.now() + 1000 * 60 * 10;
  await saveUsers(users);

  const sent = await sendVerificationEmail(email, code);
  if (!sent) console.log(`[Email] Verification code for ${email}: ${code}`);
  return { success: true, smtpSent: sent };
}

// ============ 登录 ============
async function login(email, password) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };
  if (!user.verified) return { success: false, error: '邮箱未验证，请先完成注册' };
  if (!verifyPassword(password, user.passwordHash)) return { success: false, error: '密码错误' };

  // 生成 token
  const token = crypto.randomBytes(32).toString('hex');
  const tokens = await loadTokens();
  tokens[token] = {
    email, userId: user.id, username: user.username,
    createdAt: Date.now(),
  };
  await saveTokens(tokens);

  return { success: true, token, user: { id: user.id, email, username: user.username, publicProfile: !!user.publicProfile, signature: user.signature || '' } };
}

// ============ Token 验证 ============
async function validateToken(token) {
  if (!token) return null;
  const tokens = await loadTokens();
  const entry = tokens[token];
  if (!entry) return null;
  // Token 30 天过期
  if (Date.now() - entry.createdAt > 1000 * 60 * 60 * 24 * 30) {
    delete tokens[token];
    await saveTokens(tokens);
    return null;
  }
  // 获取最新的 publicProfile 状态
  let publicProfile = false;
  let avatar = null;
  let signature = '';
  try {
    const users = await loadUsers();
    if (users[entry.email]) {
      publicProfile = !!users[entry.email].publicProfile;
      avatar = users[entry.email].avatar || null;
      signature = users[entry.email].signature || '';
    }
  } catch {}
  return { id: entry.userId, email: entry.email, username: entry.username, publicProfile, avatar, signature };
}

// ============ 登出 ============
async function logout(token) {
  const tokens = await loadTokens();
  delete tokens[token];
  await saveTokens(tokens);
}

// ============ 公开资料开关 ============
async function setPublicProfile(email, enabled) {
  const users = await loadUsers();
  if (!users[email]) return { success: false, error: '用户不存在' };
  users[email].publicProfile = !!enabled;
  await saveUsers(users);
  return { success: true, publicProfile: users[email].publicProfile };
}

// ============ 搜索公开用户（按用户名模糊匹配） ============
async function searchUsers(query) {
  if (!query || query.length < 1) return [];
  const users = await loadUsers();
  const q = query.toLowerCase();
  const results = [];
  for (const email of Object.keys(users)) {
    const u = users[email];
    if (!u.verified || !u.publicProfile) continue;
    if (u.username.toLowerCase().includes(q)) {
      results.push({ id: u.id, username: u.username, avatar: u.avatar || null });
    }
  }
  return results;
}

// ============ 按 ID 查找用户 ============
async function getUserById(userId) {
  const users = await loadUsers();
  for (const email of Object.keys(users)) {
    const u = users[email];
    if (u.id === userId && u.verified && u.publicProfile) {
      return { id: u.id, username: u.username, avatar: u.avatar || null, background: u.background || null, signature: u.signature || '' };
    }
  }
  return null;
}

// ============ 发送操作验证码（登录后使用） ============
async function sendOperationCode(email, operation) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };

  const code = generateCode();
  user.opCode = code;
  user.opCodeExpires = Date.now() + 1000 * 60 * 10;
  user.opCodeScope = operation;
  await saveUsers(users);

  const sent = await sendOperationEmail(email, code, operation);
  if (!sent) console.log(`[Email] ${operation} code for ${email}: ${code}`);
  return { success: true, smtpSent: sent };
}

function _verifyOpCode(users, email, code, operation) {
  const user = users[email];
  if (!user) return { ok: false, error: '用户不存在' };
  if (!user.opCode || user.opCodeScope !== operation) return { ok: false, error: '请先发送验证码' };
  if (Date.now() > user.opCodeExpires) return { ok: false, error: '验证码已过期，请重新发送' };
  if (user.opCode !== code) return { ok: false, error: '验证码错误' };
  delete user.opCode;
  delete user.opCodeExpires;
  delete user.opCodeScope;
  return { ok: true };
}

// ============ 修改密码（邮箱验证码确认） ============
async function changePassword(email, code, newPassword) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };
  if (newPassword.length < 6) return { success: false, error: '新密码至少 6 位' };

  const v = _verifyOpCode(users, email, code, 'changePassword');
  if (!v.ok) return { success: false, error: v.error };

  user.passwordHash = hashPassword(newPassword);
  await saveUsers(users);
  return { success: true };
}

// ============ 修改用户名 ============
async function changeUsername(email, newUsername) {
  if (!newUsername || newUsername.trim().length < 1) return { success: false, error: '用户名不能为空' };
  if (newUsername.trim().length > 20) return { success: false, error: '用户名不能超过 20 个字符' };
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };
  const newName = newUsername.trim();
  user.username = newName;
  await saveUsers(users);

  // 同步更新所有 token 中的 username
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) {
      tokens[tid].username = newName;
    }
  }
  await saveTokens(tokens);

  return { success: true, username: newName };
}

// ============ 个性签名 ============
async function setSignature(email, signature) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };
  const sig = (signature || '').trim().slice(0, 50);
  user.signature = sig;
  await saveUsers(users);

  // 同步更新 token 中的 signature
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) {
      tokens[tid].signature = sig;
    }
  }
  await saveTokens(tokens);

  return { success: true, signature: sig };
}

// ============ 头像 ============
async function setAvatar(email, avatarBuffer) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };

  // 确保头像目录存在
  if (!fss.existsSync(AVATAR_DIR)) {
    fss.mkdirSync(AVATAR_DIR, { recursive: true });
  }

  // 删除旧头像
  if (user.avatar) {
    const oldPath = path.join(AVATAR_DIR, user.avatar);
    try { await fs.unlink(oldPath); } catch {}
  }

  const avatarId = crypto.randomUUID();
  const avatarName = `${avatarId}.png`;
  const avatarPath = path.join(AVATAR_DIR, avatarName);
  await fs.writeFile(avatarPath, avatarBuffer);

  user.avatar = avatarName;
  await saveUsers(users);
  return { success: true, avatar: avatarName };
}

// ============ 注销账号（邮箱验证码确认） ============
async function deleteAccount(email, code) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };

  const v = _verifyOpCode(users, email, code, 'deleteAccount');
  if (!v.ok) return { success: false, error: v.error };

  // 删除用户
  delete users[email];
  await saveUsers(users);

  // 删除该用户所有 token
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) {
      delete tokens[tid];
    }
  }
  await saveTokens(tokens);

  // 删除头像
  if (user.avatar) {
    const avatarPath = path.join(AVATAR_DIR, user.avatar);
    try { await fs.unlink(avatarPath); } catch {}
  }

  // 删除背景图
  if (user.background) {
    const bgPath = path.join(BG_DIR, user.background);
    try { await fs.unlink(bgPath); } catch {}
  }

  // 删除个人简介
  const bioPath = _getBioPath(user.id);
  try { await fs.unlink(bioPath); } catch {}

  return { success: true };
}

// ============ 发送找回密码验证码 ============
async function sendResetCode(email) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '该邮箱未注册' };
  if (!user.verified) return { success: false, error: '该邮箱未验证' };

  const code = generateCode();
  user.opCode = code;
  user.opCodeExpires = Date.now() + 1000 * 60 * 10;
  user.opCodeScope = 'resetPassword';
  await saveUsers(users);

  const sent = await sendOperationEmail(email, code, 'resetPassword');
  if (!sent) console.log(`[Email] resetPassword code for ${email}: ${code}`);
  return { success: true, smtpSent: sent };
}

// ============ 重置密码（找回密码） ============
async function resetPassword(email, code, newPassword) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '该邮箱未注册' };
  if (!user.verified) return { success: false, error: '该邮箱未验证' };
  if (newPassword.length < 6) return { success: false, error: '新密码至少 6 位' };

  const v = _verifyOpCode(users, email, code, 'resetPassword');
  if (!v.ok) return { success: false, error: v.error };

  user.passwordHash = hashPassword(newPassword);
  await saveUsers(users);

  // 清除该用户所有 token（强制重新登录）
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) delete tokens[tid];
  }
  await saveTokens(tokens);

  return { success: true };
}

// ============ 个人简介（Markdown） ============
function _getBioPath(userId) {
  return path.join(PROFILE_DIR, `${userId}.md`);
}

async function getProfileBio(userId) {
  const bioPath = _getBioPath(userId);
  try {
    return await fs.readFile(bioPath, 'utf8');
  } catch {
    return '';
  }
}

async function saveProfileBio(userId, content) {
  if (!fss.existsSync(PROFILE_DIR)) {
    fss.mkdirSync(PROFILE_DIR, { recursive: true });
  }
  const bioPath = _getBioPath(userId);
  await fs.writeFile(bioPath, content, 'utf8');
  return { success: true };
}

// ============ 背景图 ============
async function setProfileBackground(email, bgBuffer) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '用户不存在' };

  if (!fss.existsSync(BG_DIR)) {
    fss.mkdirSync(BG_DIR, { recursive: true });
  }

  // 删除旧背景
  if (user.background) {
    const oldPath = path.join(BG_DIR, user.background);
    try { await fs.unlink(oldPath); } catch {}
  }

  const bgId = crypto.randomUUID();
  const bgName = `${bgId}.png`;
  const bgPath = path.join(BG_DIR, bgName);
  await fs.writeFile(bgPath, bgBuffer);

  user.background = bgName;
  await saveUsers(users);
  return { success: true, background: bgName };
}

function getProfileBackground(userId) {
  const users = loadUsersSync();
  if (!users) return null;
  for (const email of Object.keys(users)) {
    const u = users[email];
    if (u.id === userId && u.background) {
      return u.background;
    }
  }
  return null;
}

function loadUsersSync() {
  try { return JSON.parse(fss.readFileSync(DATA_FILE, 'utf8')); }
  catch { return null; }
}

// ============ 管理员操作 ============

// 管理员注销用户（按邮箱）
async function adminDeleteUser(email) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: '该邮箱未注册' };

  // 删除用户
  delete users[email];
  await saveUsers(users);

  // 删除该用户所有 token
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) delete tokens[tid];
  }
  await saveTokens(tokens);

  // 删除头像
  if (user.avatar) {
    const avatarPath = path.join(AVATAR_DIR, user.avatar);
    try { await fs.unlink(avatarPath); } catch {}
  }

  // 删除背景图
  if (user.background) {
    const bgPath = path.join(BG_DIR, user.background);
    try { await fs.unlink(bgPath); } catch {}
  }

  // 删除个人简介
  const bioPath = _getBioPath(user.id);
  try { await fs.unlink(bioPath); } catch {}

  return { success: true, username: user.username };
}

// 管理员修改用户邮箱
async function adminChangeEmail(oldEmail, newEmail) {
  if (!newEmail || !newEmail.includes('@')) return { success: false, error: '新邮箱格式不正确' };
  const users = await loadUsers();
  const user = users[oldEmail];
  if (!user) return { success: false, error: '原邮箱未注册' };
  if (users[newEmail] && users[newEmail].verified) return { success: false, error: '新邮箱已被注册' };

  users[newEmail] = user;
  delete users[oldEmail];
  await saveUsers(users);

  // 同步更新所有 token 中的邮箱
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === oldEmail) {
      tokens[tid].email = newEmail;
    }
  }
  await saveTokens(tokens);

  return { success: true, username: user.username, oldEmail, newEmail };
}

module.exports = { init, register, verify, login, logout, resendCode, validateToken, setPublicProfile, searchUsers, getUserById, sendOperationCode, changePassword, changeUsername, setSignature, setAvatar, deleteAccount, sendResetCode, resetPassword, getProfileBio, saveProfileBio, setProfileBackground, getProfileBackground, adminDeleteUser, adminChangeEmail };