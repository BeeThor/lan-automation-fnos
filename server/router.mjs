import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { AppError, normalizeMac } from './settings.mjs';

const loginPath = '/cgi-bin/luci/';
const authPath = loginPath + 'api/auth';
const loginKeyPattern = /GibberishAES\.enc\(\s*passwordEl\.value\s*,\s*["']([a-f0-9]{32})["']\s*\)/i;
const deviceQuery = {
  method: 'cmdArr',
  params: {
    device: 'pc',
    params: [{
      method: 'devSta.get',
      params: {
        module: 'user_list', noParse: true, async: null, remoteIp: false,
        data: { devType: 'all', dataType: 'timely' },
      },
    }],
  },
};

export function encodePassword(password, passphrase, salt = randomBytes(8)) {
  // The eWeb login page uses GibberishAES's OpenSSL salted AES-256-CBC format.
  const blocks = [];
  let previous = Buffer.alloc(0);
  for (let index = 0; index < 3; index += 1) {
    previous = createHash('md5').update(previous).update(passphrase, 'utf8').update(salt).digest();
    blocks.push(previous);
  }
  const key = Buffer.concat(blocks.slice(0, 2));
  const cipher = createCipheriv('aes-256-cbc', key, blocks[2]);
  return Buffer.concat([
    Buffer.from('Salted__'), salt, cipher.update(password, 'utf8'), cipher.final(),
  ]).toString('base64');
}

class SessionExpired extends Error {}

function asText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

function deviceName(value) {
  const text = asText(value);
  return ['*', '-', '--'].includes(text) ? '' : text;
}

export function normalizeDevices(rows) {
  const devices = new Map();
  for (const row of rows) {
    const mac = normalizeMac(row?.mac);
    if (!mac) continue;
    // Ruijie eWeb stores the user-editable remark in name.
    const alias = deviceName(row.name);
    const name = alias || deviceName(row.hostName);
    const reading = typeof row.rssi === 'number' || (typeof row.rssi === 'string' && row.rssi.trim())
      ? Number(row.rssi) : NaN;
    devices.set(mac, {
      mac, alias, name: name || '未命名设备',
      ip: isIPv4(row.userIp) ? row.userIp : '',
      os: asText(row.osType),
      connection: asText(row.connectType),
      rssi: row.connectType === 'wireless' && Number.isInteger(reading) && reading < 0 && reading >= -127 ? reading : null,
    });
  }
  return [...devices.values()];
}

export class RouterClient {
  constructor(settings, transport = fetch) {
    this.settings = settings;
    this.origin = `http://${settings.host}`;
    this.transport = transport;
    this.sid = '';
    this.rejected = null;
    this.inFlight = null;
  }

  async request(path, options = {}, sid) {
    const url = new URL(path, this.origin);
    if (sid) url.searchParams.set('auth', sid);
    let response;
    try {
      response = await this.transport(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new AppError('无法连接路由器，请检查地址和飞牛到路由器的网络。', 502);
    }
    if (sid && [401, 403].includes(response.status)) {
      await response.body?.cancel();
      throw new SessionExpired();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`路由器返回 HTTP ${response.status}。`, 502);
    }
    return response;
  }

  async post(path, data, sid) {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    }, sid);
    try {
      return await response.json();
    } catch {
      throw new AppError('路由器返回了无法识别的数据。', 502);
    }
  }

  async loginParameters() {
    const response = await this.request(loginPath, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache', Accept: 'text/html' },
    });
    const clock = Date.parse(response.headers.get('date'));
    const page = await response.text().catch(() => '');
    const key = loginKeyPattern.exec(page)?.[1];
    if (!key) throw new AppError('锐捷路由器未提供可识别的登录加密参数，请检查地址或固件。', 502);
    return { key, time: String(Math.round((Number.isFinite(clock) ? clock : Date.now()) / 1000)) };
  }

  async login() {
    if (this.rejected) throw this.rejected;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { key, time } = await this.loginParameters();
      const result = await this.post(authPath, {
        method: 'login',
        params: { username: 'admin', time, encry: true, pwd: encodePassword(this.settings.password, key) },
      });
      if (typeof result?.data?.sid === 'string' && result.data.sid.length > 0) {
        this.sid = result.data.sid;
        return;
      }
      if (result?.data?.lockTime) {
        this.rejected = new AppError('路由器暂时锁定了登录，请稍后在设置中重新连接。', 422);
        throw this.rejected;
      }
      if (result?.data?.reload) continue;
      this.rejected = new AppError('路由器登录失败，请核对管理密码，然后在设置中重新连接。', 422);
      throw this.rejected;
    }
    this.rejected = new AppError('路由器两次拒绝了新的加密参数，请在连接设置中重试。', 502);
    throw this.rejected;
  }

  async readDevices() {
    const result = await this.post('/cgi-bin/luci/api/cmd', deviceQuery, this.sid);
    if (Number(result?.code) === 2) throw new SessionExpired();
    const data = result?.data?.[0];
    if (String(result?.code) !== '0' || String(data?.code) !== '0' || !Array.isArray(data?.list)) {
      throw new AppError('路由器未返回有效的实时设备列表。', 502);
    }
    const devices = normalizeDevices(data.list);
    if (data.list.length && !devices.length) {
      throw new AppError('设备列表缺少有效 MAC 地址，请检查路由器固件。', 502);
    }
    return devices;
  }

  async query() {
    if (!this.sid) await this.login();
    try {
      return await this.readDevices();
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error;
    }
    this.sid = '';
    await this.login();
    try {
      return await this.readDevices();
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error;
      this.sid = '';
      this.rejected = new AppError('路由器没有接受新的登录会话，请在连接设置中重新连接。', 502);
      throw this.rejected;
    }
  }

  listDevices() {
    if (!this.inFlight) {
      this.inFlight = this.query().finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }
}
