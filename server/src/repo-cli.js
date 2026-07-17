/**
 * 仓库管理 CLI 命令
 * 提供 ls, tree, rm, mkdir, du, info 命令
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function resolvePath(relPath) {
  const safe = path.normalize(relPath || '').replace(/^(\.\.[/\\])+/, '');
  const full = path.join(config.UPLOAD_DIR, safe);
  if (!full.startsWith(config.UPLOAD_DIR)) {
    throw new Error('路径超出仓库范围');
  }
  return full;
}

function ls(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    console.log(`  路径不存在: ${relPath || '/'}`);
    return;
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    console.log(`  -  ${formatSize(stat.size)}  ${new Date(stat.mtime).toLocaleString()}  ${path.basename(full)}`);
    return;
  }
  const entries = fs.readdirSync(full);
  const rel = path.relative(config.UPLOAD_DIR, full) || '.';
  console.log(`\n  ${rel}/`);
  if (entries.length === 0) {
    console.log('  (空目录)');
    return;
  }
  const list = entries.map(n => {
    const s = fs.statSync(path.join(full, n));
    return { name: n, isDir: s.isDirectory(), size: s.size, mtime: s.mtime };
  }).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  for (const e of list) {
    const prefix = e.isDir ? 'd' : '-';
    console.log(`  ${prefix}  ${formatSize(e.size).padStart(8)}  ${new Date(e.mtime).toLocaleString()}  ${e.name}${e.isDir ? '/' : ''}`);
  }
  console.log(`\n  ${list.length} 个项目\n`);
}

function tree(relPath, indent = '') {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    console.log(`${indent}${path.basename(full)} (不存在)`);
    return;
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    console.log(`${indent}${path.basename(full)} (${formatSize(stat.size)})`);
    return;
  }
  console.log(`${indent}${path.basename(full) || relPath || 'file'}/`);
  const entries = fs.readdirSync(full).sort();
  for (let i = 0; i < entries.length; i++) {
    const isLast = i === entries.length - 1;
    const child = path.join(full, entries[i]);
    const prefix = indent + (isLast ? '  └─ ' : '  ├─ ');
    tree(path.relative(config.UPLOAD_DIR, child), prefix);
  }
}

function rm(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    console.log(`  路径不存在: ${relPath}`);
    return;
  }
  try {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`  已删除: ${relPath}`);
  } catch (err) {
    console.log(`  删除失败: ${err.message}`);
  }
}

function mkdir(relPath) {
  const full = resolvePath(relPath);
  if (fs.existsSync(full)) {
    console.log(`  路径已存在: ${relPath}`);
    return;
  }
  try {
    fs.mkdirSync(full, { recursive: true });
    console.log(`  已创建: ${relPath}`);
  } catch (err) {
    console.log(`  创建失败: ${err.message}`);
  }
}

function du(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    console.log(`  路径不存在: ${relPath || '/'}`);
    return;
  }
  let totalSize = 0, totalFiles = 0, totalDirs = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const s = fs.statSync(p);
      if (s.isDirectory()) { totalDirs++; walk(p); }
      else { totalSize += s.size; totalFiles++; }
    }
  };
  const stat = fs.statSync(full);
  if (stat.isDirectory()) { totalDirs++; walk(full); }
  else { totalSize = stat.size; totalFiles = 1; }
  console.log(`\n  ${relPath || '仓库根目录'}`);
  console.log(`  文件数: ${totalFiles}`);
  console.log(`  文件夹: ${totalDirs}`);
  console.log(`  总大小: ${formatSize(totalSize)}\n`);
}

function info(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    console.log(`  路径不存在: ${relPath}`);
    return;
  }
  const stat = fs.statSync(full);
  console.log(`\n  路径:     ${relPath || '/'}`);
  console.log(`  类型:     ${stat.isDirectory() ? '目录' : '文件'}`);
  console.log(`  大小:     ${formatSize(stat.size)}`);
  console.log(`  创建时间: ${new Date(stat.birthtime).toLocaleString()}`);
  console.log(`  修改时间: ${new Date(stat.mtime).toLocaleString()}`);
  if (stat.isDirectory()) {
    console.log(`  子项数:   ${fs.readdirSync(full).length}`);
  }
  console.log('');
}

module.exports = { ls, tree, rm, mkdir, du, info, formatSize };