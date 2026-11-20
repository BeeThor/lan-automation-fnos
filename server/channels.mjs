import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './settings.mjs';
import { localClock } from './calendar.mjs';

export function channelConfig(input, previous) {
  const { type } = input;
  const name = String(input.name || '').trim();
  if (!name || name.length > 40) throw new AppError('渠道名称须为 1 至 40 个字符。');
  if (!['serverchan', 'pushdeer'].includes(type) || (previous && previous.type !== type)) throw new AppError('请选择有效的渠道类型。');
  const key = input.key?.trim() || previous?.key;
  if (!key || key.length > 256 || /\s/.test(key)) throw new AppError('请填写有效的推送密钥。');
  const common = { id: previous?.id || randomUUID(), name, type, key };
  if (type === 'serverchan') {
    if (!/^SCT[0-9A-Za-z]+$/.test(key)) throw new AppError('请填写以 SCT 开头的 Turbo SendKey。');
    const limit = input.limit ?? 5;
    if (![5, 1000].includes(limit)) throw new AppError('请选择每日额度。');
    return { ...common, limit };
  }
  let url;
  try { url = new URL(input.endpoint); } catch { throw new AppError('请填写完整的 PushDeer 服务地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError('服务地址须为 HTTP 或 HTTPS，不含凭据、查询参数或片段。');
  }
  const endpoint = url.href.replace(/\/+$/, '').replace(/\/message\/push$/, '');
  if (previous && previous.endpoint !== endpoint && !input.key?.trim()) throw new AppError('更换服务地址时须重新输入 PushKey。');
  return { ...common, endpoint };
}

export const usageKey = channel => createHash('sha256').update(channel.key).digest('hex');
export function publicChannel(channel, ledger, now) {
  const { id, name, type, endpoint, limit } = channel;
  if (type === 'pushdeer') return { id, name, type, endpoint };
  const entry = ledger[usageKey(channel)];
  const used = entry?.date === localClock(now).date ? entry.count : 0;
  return { id, name, type, limit, used, remaining: Math.max(0, limit - used) };
}

export async function sendNotification(channel, title, message, transport = fetch) {
  const sct = channel.type === 'serverchan';
  const url = sct ? `https://sctapi.ftqq.com/${channel.key}.send` : channel.endpoint + '/message/push';
  const body = new URLSearchParams(sct
    ? { title: Array.from(title.replace(/\s+/g, ' ')).slice(0, 32).join(''), desp: message, noip: '1' }
    : { pushkey: channel.key, text: title, desp: message, type: 'markdown' });
  try {
    const response = await transport(url, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new AppError('推送接口返回 HTTP ' + response.status, 502);
    const data = await response.json();
    if (data?.code !== 0) throw new AppError('推送服务拒绝请求，请检查密钥、额度及接收设备。', 502);
    if (!sct && Array.isArray(data.content?.result) && !data.content.result.length) throw new AppError('PushDeer 未返回接收设备。', 502);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('无法确认推送结果，请检查服务地址和网络。', 502);
  }
}
