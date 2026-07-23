// ============ 文件写入队列锁 ============
// 防止高并发下同时写入同一文件导致事件循环阻塞
// 每个文件一个 Promise 队列，写入操作串行化

const fs = require('fs').promises;
const locks = new Map(); // filePath -> Promise<void>

async function acquireLock(filePath) {
  const prev = locks.get(filePath) || Promise.resolve();
  let resolve;
  const next = new Promise(r => { resolve = r; });
  locks.set(filePath, next);
  await prev;
  return resolve;
}

async function readJSON(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw;
  } catch {
    return null;
  }
}

async function writeJSON(filePath, content) {
  const release = await acquireLock(filePath);
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } finally {
    release();
  }
}

module.exports = { readJSON, writeJSON };