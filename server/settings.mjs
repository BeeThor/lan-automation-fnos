import { isIPv4 } from 'node:net';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value) + '\n', {
      mode: 0o600, flag: 'wx', flush: true,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function routerSettings(value) {
  const host = typeof value?.host === 'string' ? value.host.trim() : '';
  const [a, b] = host.split('.').map(Number);
  const privateNetwork = a === 10 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
  if (!isIPv4(host) || !privateNetwork) {
    throw new AppError('请输入路由器的内网 IPv4 地址，例如 192.168.1.1。');
  }
  if (typeof value.password !== 'string' || !value.password || value.password.length > 64) {
    throw new AppError('请输入路由器管理密码，最多 64 个字符。');
  }
  return { host, password: value.password };
}

export const validMac = value => (
  typeof value === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value)
);

export function normalizeMac(value) {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/[:-]/g, '');
  return /^[0-9a-f]{12}$/i.test(compact) ? compact.match(/../g).join(':').toUpperCase() : '';
}

const timePattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

const conditionStates = ['online', 'offline', 'still_online', 'still_offline'];
const actionsSupported = ['notify', 'record'];

export function ruleSettings(value, id, selectDevice) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 40) throw new AppError('请填写规则名称，最多 40 个字符。');
  const triggerDevice = selectDevice(value?.trigger?.mac);
  const triggerState = value?.trigger?.state;
  if (!validMac(triggerDevice?.mac) || !['online', 'offline'].includes(triggerState)) {
    throw new AppError('请选择触发设备和状态变化。');
  }
  if (!Array.isArray(value.conditions) || value.conditions.length > 8 || !['all', 'any'].includes(value.match)) {
    throw new AppError('条件最多可以添加 8 条。');
  }
  const conditionDevices = new Set([triggerDevice.mac]);
  const conditions = value.conditions.map(condition => {
    const device = selectDevice(condition?.mac);
    if (!validMac(device?.mac) || !conditionStates.includes(condition.state)) {
      throw new AppError('请为每条条件选择设备和状态。');
    }
    if (conditionDevices.has(device.mac)) throw new AppError('同一条规则中的设备不能重复选择。');
    conditionDevices.add(device.mac);
    return { device, state: condition.state };
  });
  if (!Array.isArray(value.actions) || !value.actions.length
      || value.actions.some(action => !actionsSupported.includes(action))) {
    throw new AppError('请至少选择一个执行动作。');
  }
  const actions = [...new Set(value.actions)];
  const noticeText = typeof value.noticeText === 'string' ? value.noticeText.trim() : '';
  if (noticeText.length > 200) throw new AppError('提醒内容最多 200 个字符。');
  if (typeof value?.enabled !== 'boolean' || !['all', 'workdays'].includes(value.days)) {
    throw new AppError('请选择检测日期规则。');
  }
  if (!Array.isArray(value.ranges) || value.ranges.length < 1 || value.ranges.length > 12) {
    throw new AppError('请添加 1 至 12 个检测时段。');
  }
  const ranges = value.ranges.map(range => {
    if (typeof range?.start !== 'string' || typeof range?.end !== 'string'
        || !timePattern.test(range.start) || !timePattern.test(range.end) || range.start === range.end) {
      throw new AppError('请填写有效的开始和结束时间，两者需要不同。');
    }
    return { start: range.start, end: range.end };
  });
  const { intervalSeconds, confirmations } = value;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 300) {
    throw new AppError('检测间隔须为 1 至 300 秒。');
  }
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 10) {
    throw new AppError('离线确认次数须为 1 至 10 次。');
  }
  return {
    id, name, trigger: { device: triggerDevice, state: triggerState },
    conditions, match: value.match, actions, noticeText, enabled: value.enabled,
    days: value.days, ranges, intervalSeconds, confirmations,
  };
}
