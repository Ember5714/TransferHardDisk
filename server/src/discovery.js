/**
 * 设备发现模块 — 按子网定向 UDP 广播 + mDNS 辅助
 * 关键修复：不依赖 255.255.255.255，而是向每个网卡的子网广播地址发送
 */
const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');
const config = require('./config');

const BROADCAST_PORT = 3001;
const BROADCAST_INTERVAL = 5000;
const DEVICE_TIMEOUT = 15000;

class Discovery extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.devices = new Map();
    this.cleanupTimer = null;
    this.broadcastTimer = null;
    this.mdns = null;
    this.port = config.PORT;
    this._localAddrs = [];
    this._broadcastAddrs = [];
  }

  start(port) {
    this.port = port;

    // 收集本地网卡信息
    this._scanInterfaces();

    // UDP 广播
    this._startUdp();

    // mDNS 辅助
    this._startMdns();

    // 清理
    this.cleanupTimer = setInterval(() => this._cleanup(), DEVICE_TIMEOUT);

    console.log(`[Discovery] Started. Local IPs: ${this._localAddrs.join(', ')}`);
    console.log(`[Discovery] Broadcast targets: ${this._broadcastAddrs.join(', ')}`);
  }

  stop() {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.socket) {
      try { this._sendGoodbye(); } catch (e) {}
      this.socket.close();
      this.socket = null;
    }
    if (this.mdns) {
      try { this._mdnsGoodbye(); } catch (e) {}
      this.mdns.destroy();
      this.mdns = null;
    }
  }

  getDevices() {
    return Array.from(this.devices.values()).map(d => ({
      id: d.id, name: d.name, address: d.address, port: d.port,
    }));
  }

  getNetworkInfo() {
    return {
      localAddresses: this._localAddrs,
      broadcastTargets: this._broadcastAddrs,
      boundPort: this.socket ? this.socket.address().port : null,
    };
  }

  // ==================== 网卡扫描 ====================

  _scanInterfaces() {
    const interfaces = os.networkInterfaces();
    this._localAddrs = [];
    this._broadcastAddrs = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          this._localAddrs.push(iface.address);
          // 计算子网广播地址
          const broadcast = this._calcBroadcast(iface.address, iface.netmask);
          if (broadcast && !this._broadcastAddrs.includes(broadcast)) {
            this._broadcastAddrs.push(broadcast);
          }
        }
      }
    }
    // 兜底：始终包含全局广播
    if (!this._broadcastAddrs.includes('255.255.255.255')) {
      this._broadcastAddrs.push('255.255.255.255');
    }
  }

  _calcBroadcast(ip, mask) {
    try {
      const ipParts = ip.split('.').map(Number);
      const maskParts = mask.split('.').map(Number);
      if (ipParts.length !== 4 || maskParts.length !== 4) return null;
      const broadcast = ipParts.map((o, i) => (o | (~maskParts[i] & 255))).join('.');
      return broadcast;
    } catch { return null; }
  }

  // ==================== UDP ====================

  _startUdp() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      this.socket.setBroadcast(true);
      const addr = this.socket.address();
      console.log(`[Discovery] UDP listening: ${addr.address}:${addr.port}`);

      this._broadcastPresence();
      this.broadcastTimer = setInterval(() => this._broadcastPresence(), BROADCAST_INTERVAL);
    });

    this.socket.on('message', (msg, rinfo) => {
      this._handleMessage(msg, rinfo);
    });

    this.socket.on('error', (err) => {
      console.error('[Discovery] UDP error:', err.message);
    });

    this.socket.bind(BROADCAST_PORT);
  }

  _broadcastPresence() {
    if (!this.socket) return;
    const message = JSON.stringify({
      type: 'hello',
      id: config.DEVICE_ID,
      name: config.DEVICE_NAME,
      port: this.port,
    });
    const buf = Buffer.from(message, 'utf8');

    // 向每个子网广播地址分别发送
    for (const addr of this._broadcastAddrs) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr, (err) => {
        if (err) console.error(`[Discovery] Broadcast to ${addr} failed:`, err.message);
      });
    }
  }

  _sendGoodbye() {
    if (!this.socket) return;
    const message = JSON.stringify({ type: 'goodbye', id: config.DEVICE_ID });
    const buf = Buffer.from(message, 'utf8');
    for (const addr of this._broadcastAddrs) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr);
    }
  }

  _handleMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data.id === config.DEVICE_ID) return;

      // 放宽子网检查：只要对方不是 127.x.x.x 就接受
      if (rinfo.address.startsWith('127.')) return;

      if (data.type === 'hello') {
        const isNew = !this.devices.has(data.id);
        this.devices.set(data.id, {
          id: data.id,
          name: data.name || 'Unknown',
          address: rinfo.address,
          port: data.port || this.port,
          lastSeen: Date.now(),
        });

        if (isNew) {
          console.log(`[Discovery] Found (UDP): ${data.name} @ ${rinfo.address}:${data.port}`);
          this.emit('device-online', {
            id: data.id, name: data.name, address: rinfo.address, port: data.port || this.port,
          });
        } else {
          this.devices.get(data.id).lastSeen = Date.now();
        }
      } else if (data.type === 'goodbye') {
        if (this.devices.has(data.id)) {
          const d = this.devices.get(data.id);
          console.log(`[Discovery] Offline (UDP): ${d.name}`);
          this.devices.delete(data.id);
          this.emit('device-offline', { id: data.id, name: d.name });
        }
      }
    } catch (e) {
      // ignore non-JSON
    }
  }

  // ==================== mDNS ====================

  _startMdns() {
    try {
      const multicastDNS = require('multicast-dns');
      this.mdns = multicastDNS();
      const svc = `${config.DEVICE_NAME}._${config.MDNS_SERVICE_TYPE}`;

      this.mdns.on('response', (r) => {
        const answers = r.answers || [];
        let id = null, name = '', port = null;
        for (const a of answers) {
          if (!a.name || !a.name.includes(config.MDNS_SERVICE_TYPE.replace('_', ''))) continue;
          if (a.type === 'TXT' && a.data) {
            const txt = typeof a.data === 'string' ? a.data : a.data.toString();
            const p = new URLSearchParams(txt);
            id = p.get('id'); name = decodeURIComponent(p.get('name') || '');
          }
          if (a.type === 'SRV' && a.data) port = a.data.port;
        }
        if (!id || id === config.DEVICE_ID || this.devices.has(id)) return;
        this.devices.set(id, {
          id, name: name || 'Unknown', address: 'unknown', port: port || this.port, lastSeen: Date.now(),
        });
        console.log(`[Discovery] Found (mDNS): ${name}`);
      });

      this.mdns.on('query', (q) => {
        if (q.questions.some((x) => x.name && x.name.includes(config.MDNS_SERVICE_TYPE.replace('_', '')))) {
          this.mdns.respond({
            answers: [
              { name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` } },
              { name: svc, type: 'TXT', data: Buffer.from(`id=${config.DEVICE_ID}&name=${encodeURIComponent(config.DEVICE_NAME)}`) },
            ],
          });
        }
      });

      this.mdns.respond({
        answers: [
          { name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` } },
          { name: svc, type: 'TXT', data: Buffer.from(`id=${config.DEVICE_ID}&name=${encodeURIComponent(config.DEVICE_NAME)}`) },
        ],
      });
    } catch (err) {
      console.log('[Discovery] mDNS start failed (non-fatal):', err.message);
    }
  }

  _mdnsGoodbye() {
    if (!this.mdns) return;
    const svc = `${config.DEVICE_NAME}._${config.MDNS_SERVICE_TYPE}`;
    this.mdns.respond({ answers: [{ name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` }, ttl: 0 }] });
  }

  // ==================== 清理 ====================

  _cleanup() {
    const now = Date.now();
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > DEVICE_TIMEOUT) {
        console.log(`[Discovery] Timeout: ${d.name}`);
        this.devices.delete(id);
        this.emit('device-offline', { id, name: d.name });
      }
    }
  }
}

module.exports = new Discovery();