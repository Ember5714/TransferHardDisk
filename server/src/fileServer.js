/**
 * 文件服务模块 — 网盘核心
 * 目录浏览、文件上传/下载、缩略图、文件夹操作
 * 支持 用户隔离：
 * - 私密：`private/{userId}/...`
 * - 公开：`public/{userId}/...` (可被搜索访问)
 */
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const zlib = require('zlib');
const crypto = require('crypto');
const config = require('./config');

// 文件类型图标映射
const MIME_ICONS = {
  image: '🖼️', video: '🎬', audio: '🎵',
  pdf: '📄', zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️',
  txt: '📃', md: '📃', json: '📃', xml: '📃', csv: '📃',
  js: '💻', ts: '💻', jsx: '💻', tsx: '💻', py: '💻', java: '💻', html: 'html', css: '💻',
  exe: '⚙️', msi: '⚙️', dll: '⚙️',
};

class FileServer {
  constructor() {
    this.uploadDir = config.UPLOAD_DIR;
    this._ensureRoot();
  }

  _ensureRoot() {
    try {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }
    } catch (e) {
      // 目录存在但 ACL 损坏导致无法访问，尝试修复
      if (e.code === 'EPERM') {
        try {
          fs.mkdirSync(this.uploadDir, { recursive: true });
        } catch (_) {
          console.error(`[FileServer] 无法访问存储目录: ${this.uploadDir}`);
          console.error('[FileServer] 请以管理员身份运行: icacls "' + this.uploadDir + '" /reset /T /Q');
          process.exit(1);
        }
      } else {
        throw e;
      }
    }
    // 确保 public/private 根目录存在
    ['public', 'private'].forEach(dir => {
      const p = path.join(this.uploadDir, dir);
      try {
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      } catch (_) {}
    });
  }

  /** 复制公开用户的文件到自己的私密仓库 */
  async copyFromPublic(srcUserId, filePath, destUserId) {
    const srcAbs = this._buildPath(srcUserId, 'public', filePath);
    this._checkPath(srcAbs);
    this._checkUserIsolation(srcAbs, srcUserId);
    if (!fs.existsSync(srcAbs)) throw new Error('文件不存在');

    const stat = await fsp.stat(srcAbs);
    const destDir = this._buildPath(destUserId, 'private', path.dirname(filePath));
    if (!fs.existsSync(destDir)) {
      await fsp.mkdir(destDir, { recursive: true });
    }

    const destAbs = this._buildPath(destUserId, 'private', filePath);
    if (fs.existsSync(destAbs)) throw new Error('目标文件已存在，请先重命名');

    if (stat.isDirectory()) {
      await fsp.cp(srcAbs, destAbs, { recursive: true });
    } else {
      await fsp.cp(srcAbs, destAbs);
    }
    return { path: filePath, name: path.basename(filePath) };
  }

  /**
   * 构建完整路径: 私密: private/{userId}/{relative} 公开: public/{userId}/{relative}
   */
  _buildPath(userId, visibility, relativePath) {
    const baseDir = visibility === 'public' ? 'public' : 'private';
    const root = path.resolve(this.uploadDir);
    const fullPath = path.join(root, baseDir, userId, relativePath || '');
    return fullPath;
  }

  /** 安全检查：禁止访问存储根目录之外，使用 path.relative 防止路径穿越 */
  _checkPath(absPath) {
    const root = path.resolve(this.uploadDir);
    const rel = path.relative(root, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('禁止访问该目录');
    }
  }

  /** 用户隔离检查：验证路径中包含当前用户 ID，防止跨用户访问 */
  _checkUserIsolation(absPath, userId) {
    const root = path.resolve(this.uploadDir);
    const rel = path.relative(root, absPath);
    const segments = rel.split(path.sep);
    if (segments.length < 2 || segments[1] !== userId) {
      throw new Error('禁止访问该目录');
    }
  }

  /** 获取文件类型分类 */
  _getCategory(name) {
    const ext = path.extname(name).toLowerCase().replace('.', '');
    if (['jpg','jpeg','png','gif','webp','bmp','svg','ico'].includes(ext)) return 'image';
    if (['mp4','mkv','avi','mov','wmv','flv','webm'].includes(ext)) return 'video';
    if (['mp3','wav','flac','aac','ogg','wma'].includes(ext)) return 'audio';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return 'archive';
    if (['doc','docx'].includes(ext)) return 'doc';
    if (['xls','xlsx','csv'].includes(ext)) return 'sheet';
    if (['ppt','pptx'].includes(ext)) return 'slides';
    if (['txt','md','json','xml','yml','yaml','log','ini','cfg'].includes(ext)) return 'text';
    if (['js','ts','jsx','tsx','py','java','c','cpp','h','go','rs','rb','php','html','css','vue','swift','kt'].includes(ext)) return 'code';
    if (['exe','msi','dll','bat','sh','ps1','cmd'].includes(ext)) return 'exec';
    return 'file';
  }

  _getIcon(name, isDir) {
    if (isDir) return '📁';
    const cat = this._getCategory(name);
    return MIME_ICONS[cat] || '📄';
  }

  /** 浏览目录 */
  async browse(userId, visibility, dirPath) {
    const absPath = this._buildPath(userId, visibility, dirPath);
    this._checkPath(absPath);
    this._checkUserIsolation(absPath, userId);

    // 确保目录存在（用户首次访问时自动创建）
    if (!fs.existsSync(absPath)) {
      fs.mkdirSync(absPath, { recursive: true });
    }

    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    const items = [];

    for (const e of entries) {
      const fullPath = path.join(absPath, e.name);
      let stat;
      try { stat = await fsp.stat(fullPath); } catch { continue; }

      items.push({
        name: e.name,
        path: dirPath ? path.join(dirPath, e.name) : e.name,
        fullPath,
        isDir: e.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        category: e.isDirectory() ? 'folder' : this._getCategory(e.name),
        icon: this._getIcon(e.name, e.isDirectory()),
      });
    }

    // 排序：文件夹在前，然后按名称
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    const rootUserPath = this._buildPath(userId, visibility, null);
    const parent = (!dirPath || dirPath === '') ? null : path.dirname(dirPath);

    return {
      dir: dirPath,
      absDir: absPath,
      visibility,
      userId,
      items,
      parent,
    };
  }

  /** 创建文件夹 */
  async mkdir(userId, visibility, dirPath, name) {
    const absPath = this._buildPath(userId, visibility, dirPath);
    this._checkPath(absPath);
    this._checkUserIsolation(absPath, userId);
    const newDir = path.join(absPath, name);
    this._checkPath(newDir);
    if (fs.existsSync(newDir)) throw new Error('文件夹已存在');
    await fsp.mkdir(newDir, { recursive: true });
    const relPath = dirPath ? path.join(dirPath, name) : name;
    return { path: relPath, name, visibility, userId };
  }

  /** 删除文件或文件夹 */
  async delete(userId, visibility, targetPath) {
    const absPath = this._buildPath(userId, visibility, targetPath);
    this._checkPath(absPath);
    this._checkUserIsolation(absPath, userId);
    if (!fs.existsSync(absPath)) throw new Error('文件不存在');
    const stat = await fsp.stat(absPath);
    if (stat.isDirectory()) {
      await fsp.rm(absPath, { recursive: true, force: true });
    } else {
      await fsp.unlink(absPath);
    }
    return true;
  }

  /** 重命名 */
  async rename(userId, visibility, oldPath, newName) {
    const absOld = this._buildPath(userId, visibility, oldPath);
    this._checkPath(absOld);
    this._checkUserIsolation(absOld, userId);
    const dir = path.dirname(absOld);
    const absNew = path.join(dir, newName);
    this._checkPath(absNew);
    if (fs.existsSync(absNew)) throw new Error('目标名称已存在');
    await fsp.rename(absOld, absNew);
    const relNew = path.join(path.dirname(oldPath), newName);
    return { path: relNew, name: newName, visibility, userId };
  }

  /** 创建加密下载流：压缩 → AES-256-CTR 加密，密钥通过 Header 先于文件体发送 */
  createEncryptedDownloadStream(userId, visibility, filePath) {
    const absPath = this._buildPath(userId, visibility, filePath);
    this._checkPath(absPath);
    this._checkUserIsolation(absPath, userId);
    const stat = fs.statSync(absPath);
    const fileName = path.basename(absPath);

    // 生成随机密钥（服务端持有，客户端通过 Header 接收）
    const key = crypto.randomBytes(32); // AES-256
    const iv = crypto.randomBytes(16);  // CTR 初始向量

    const readStream = fs.createReadStream(absPath);
    const gzip = zlib.createGzip();
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);

    // 管道：原文件 → gzip 压缩 → AES 加密 → 响应
    const stream = readStream.pipe(gzip).pipe(cipher);

    return {
      stream,
      keyB64: key.toString('base64'),
      ivB64: iv.toString('base64'),
      fileName,
      fileSize: stat.size,
    };
  }

  /** 创建下载流（不加密，用于图片预览） */
  createDownloadStream(userId, visibility, filePath, range) {
    const absPath = this._buildPath(userId, visibility, filePath);
    this._checkPath(absPath);
    this._checkUserIsolation(absPath, userId);
    const stat = fs.statSync(absPath);
    const fileSize = stat.size;

    let start = 0, end = fileSize - 1;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10) || 0;
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    }

    const ext = path.extname(absPath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.svg') mimeType = 'image/svg+xml';
    else if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.mp4') mimeType = 'video/mp4';
    else if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.txt') mimeType = 'text/plain';
    else if (ext === '.json') mimeType = 'application/json';
    else if (ext === '.html') mimeType = 'text/html';
    else if (ext === '.css') mimeType = 'text/css';
    else if (ext === '.js') mimeType = 'application/javascript';

    const isPreview = ['image/jpeg','image/png','image/gif','image/webp'].includes(mimeType);
    const inline = isPreview ? 'inline' : 'attachment';

    return {
      stream: fs.createReadStream(absPath, { start, end }),
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Disposition': `${inline}; filename*=UTF-8''${encodeURIComponent(path.basename(absPath))}`,
      },
      statusCode: range ? 206 : 200,
    };
  }

  /** 上传处理 */
  createUploadHandler() {
    const multer = require('multer');
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const { userId, visibility, dir } = req.body;
        if (!userId) return cb(new Error('缺少 userId'), '');
        const absDir = this._buildPath(userId, visibility || 'private', dir || '');
        this._checkPath(absDir);
        this._checkUserIsolation(absDir, userId);
        if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
        cb(null, absDir);
      },
      filename: (req, file, cb) => {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const { userId, visibility, dir } = req.body;
        const targetDir = this._buildPath(userId, visibility || 'private', dir || '');
        const destPath = path.join(targetDir, originalName);
        if (fs.existsSync(destPath)) {
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          cb(null, `${base}_${Date.now()}${ext}`);
        } else {
          cb(null, originalName);
        }
      },
    });

    return multer({
      storage,
      limits: {
        ...(config.MAX_FILE_SIZE > 0 ? { fileSize: parseInt(config.MAX_FILE_SIZE) } : {}),
        fieldSize: 10 * 1024 * 1024,   // 10MB 字段大小，支持大量文件
        fields: 100,                    // 最大非文件字段数
        files: config.MAX_FILE_COUNT,   // 最大文件数
      },
    });
  }

  /** 头像上传处理 */
  createAvatarUploadHandler() {
    const multer = require('multer');
    const tmpDir = path.join(config.ROOT_DIR, 'data', 'tmp');
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        cb(null, tmpDir);
      },
      filename: (req, file, cb) => {
        cb(null, `${Date.now()}_${file.originalname}`);
      },
    });
    return multer({
      storage,
      limits: { fileSize: 2 * 1024 * 1024 }, // 头像限制 2MB
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('仅支持 JPG、PNG、GIF、WebP 格式'));
      },
    });
  }

  /** 背景图上传处理 */
  createBackgroundUploadHandler() {
    const multer = require('multer');
    const tmpDir = path.join(config.ROOT_DIR, 'data', 'tmp');
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        cb(null, tmpDir);
      },
      filename: (req, file, cb) => {
        cb(null, `bg_${Date.now()}_${file.originalname}`);
      },
    });
    return multer({
      storage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 背景限制 5MB
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('仅支持 JPG、PNG、GIF、WebP 格式'));
      },
    });
  }
}

module.exports = new FileServer();