/**
 * WebSocket 信令服务模块
 * 负责设备状态广播、传输进度推送、实时通知
 */
const crypto = require('crypto');

class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { id, deviceName }
  }

  /** 初始化 WebSocket 服务 */
  init(server) {
    const WebSocket = require('ws');
    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws, req) => {
      const clientId = crypto.randomUUID();
      const clientIp = req.socket.remoteAddress;

      this.clients.set(ws, {
        id: clientId,
        ip: clientIp,
        connectedAt: Date.now(),
      });

      console.log(`[WS] 新客户端连接: ${clientId} (${clientIp})`);

      // 发送欢迎消息
      this._send(ws, {
        type: 'connected',
        payload: { clientId },
      });

      ws.on('message', (data) => {
        this._handleMessage(ws, data);
      });

      ws.on('close', () => {
        console.log(`[WS] 客户端断开: ${clientId}`);
        this.clients.delete(ws);
        this.emit('client-disconnected', clientId);
      });

      ws.on('error', (err) => {
        console.error(`[WS] 客户端错误: ${clientId}`, err.message);
      });
    });

    console.log('[WS] WebSocket 服务已启动');
  }

  /** 事件发射器兼容 */
  _handlers = {};
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  }
  emit(event, ...args) {
    const handlers = this._handlers[event] || [];
    handlers.forEach((h) => h(...args));
  }

  /** 处理收到的消息 */
  _handleMessage(ws, data) {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'ping':
          this._send(ws, { type: 'pong' });
          break;

        case 'device-info':
          this.clients.get(ws).deviceName = msg.payload?.name;
          break;

        default:
          // 转发给所有已注册的 handler
          break;
      }
    } catch (err) {
      console.error('[WS] 消息解析失败:', err.message);
    }
  }

  /** 发送消息给指定客户端 */
  _send(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }

  /** 广播给所有客户端 */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const [ws] of this.clients) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  /** 推送设备列表更新 */
  sendDeviceList(devices) {
    this.broadcast({
      type: 'device-list',
      payload: { devices },
    });
  }

  /** 推送设备上线 */
  sendDeviceOnline(device) {
    this.broadcast({
      type: 'device-online',
      payload: device,
    });
  }

  /** 推送设备离线 */
  sendDeviceOffline(device) {
    this.broadcast({
      type: 'device-offline',
      payload: device,
    });
  }

  /** 推送手动添加的设备 */
  sendManualDevice(device) {
    this.broadcast({
      type: 'manual-device',
      payload: device,
    });
  }

  /** 推送传输进度 */
  sendTransferProgress(transferId, progress, status, extra = {}) {
    this.broadcast({
      type: 'transfer-progress',
      payload: { transferId, progress, status, ...extra },
    });
  }

  /** 推送文件接收通知 */
  sendFileReceived(fileInfo) {
    this.broadcast({
      type: 'file-received',
      payload: fileInfo,
    });
  }

  /** 获取在线客户端数 */
  getClientCount() {
    return this.clients.size;
  }
}

module.exports = new WsServer();