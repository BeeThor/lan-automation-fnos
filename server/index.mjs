import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelConfig, publicChannel, sendNotification, usageKey } from './channels.mjs';
import { localClock, WorkdayCalendar } from './calendar.mjs';
import { RuleDetector } from './monitor.mjs';
import { customNotice, historicalMessage, noticeFor } from './notice.mjs';
import { RouterClient } from './router.mjs';
import { AppError, normalizeMac, readJson, routerSettings, ruleSettings, writeJson } from './settings.mjs';

const prefix = '/app/lan-automation';
const packageSocket = process.env.REMINDER_SOCKET;
const port = Number(process.env.REMINDER_PORT || 5180);
const dataDir = process.env.REMINDER_DATA_DIR || fileURLToPath(new URL('../.local-data/', import.meta.url));
const webDir = fileURLToPath(new URL(packageSocket ? './web/' : '../build/web/', import.meta.url));
const bundledCalendar = fileURLToPath(new URL(packageSocket ? './calendar/' : '../calendar/', import.meta.url));
const configPath = join(dataDir, 'settings.json');
const eventsPath = join(dataDir, 'events.json');
const calendar = new WorkdayCalendar(dataDir, bundledCalendar);
let settings = await readJson(configPath, { router: null, rules: [] });
let events = (await readJson(eventsPath, [])).map(historicalMessage);
settings.channels ??= [];
settings.usage ??= {};
// A request interrupted after dispatch may already have reached the provider.
for (const event of events) {
  for (const delivery of event.deliveries || []) {
    if (delivery.status === 'sending') delivery.status = 'unknown';
  }
}
let router = settings.router ? new RouterClient(settings.router) : null;
let detectors = new Map(settings.rules.map(rule => [rule.id, new RuleDetector(rule, calendar)]));
let knownDevices = new Map();
let mutations = Promise.resolve();
let checking = null;

await calendar.load();

function state(now = new Date()) {
  return {
    router: { configured: Boolean(router), host: settings.router?.host || '192.168.1.1' },
    channels: settings.channels.map(channel => publicChannel(channel, settings.usage, now)),
    rules: settings.rules.map(rule => ({
      ...rule,
      noticeText: customNotice(rule.noticeText),
      trigger: { ...rule.trigger, device: latestDevice(rule.trigger.device) },
      conditions: rule.conditions.map(condition => ({ ...condition, device: latestDevice(condition.device) })),
      status: detectors.get(rule.id).state(now),
    })),
    calendar: calendar.state(now),
    events,
  };
}

function enqueue(change) {
  const updated = mutations.then(change);
  mutations = updated.catch(() => {});
  return updated;
}

async function saveSettings(next) {
  await writeJson(configPath, next);
  settings = next;
}

async function countRequest(channel) {
  if (channel.type !== 'serverchan') return;
  const now = new Date();
  const { used } = publicChannel(channel, settings.usage, now);
  const usage = Object.fromEntries(Object.entries(settings.usage).filter(([, entry]) => entry.date === localClock(now).date));
  usage[usageKey(channel)] = { date: localClock(now).date, count: used + 1 };
  await saveSettings({ ...settings, usage });
}

async function deliveryStatus(eventId, channelId, status, error) {
  const next = events.map(event => event.id !== eventId ? event : { ...event,
    deliveries: event.deliveries.map(item => item.id === channelId ? { ...item, status, error } : item),
  });
  await writeJson(eventsPath, next);
  events = next;
}

let delivering = false;
async function dispatchPending() {
  if (delivering) return;
  delivering = true;
  try {
    while (true) {
      const event = events.find(e => e.deliveries?.some(d => d.status === 'pending'));
      if (!event) break;
      const item = event.deliveries.find(d => d.status === 'pending');
      const channel = await enqueue(async () => {
        const target = settings.channels.find(c => c.id === item.id);
        if (target) await countRequest(target);
        await deliveryStatus(event.id, item.id, target ? 'sending' : 'failed', target ? undefined : '渠道已删除');
        return target;
      });
      if (!channel) continue;
      let error;
      try { await sendNotification(channel, event.name, event.message); }
      catch (failure) { error = failure.message; }
      await enqueue(() => deliveryStatus(event.id, item.id, error ? 'failed' : 'accepted', error));
    }
  } catch (error) { console.error('Delivery persistence failed:', error.code || error.name); }
  finally { delivering = false; }
}

function remember(devices) {
  const next = new Map(devices.map(device => [device.mac, device]));
  for (const rule of settings.rules) {
    for (const { mac } of ruleDevices(rule)) {
      if (!next.has(mac) && knownDevices.has(mac)) next.set(mac, knownDevices.get(mac));
    }
  }
  knownDevices = next;
}

function ruleDevices(rule) {
  return rule ? [rule.trigger.device, ...rule.conditions.map(condition => condition.device)] : [];
}

function latestDevice(device) {
  return knownDevices.get(device.mac) || device;
}

async function listDevices() {
  const client = router;
  if (!client) throw new AppError('请先连接路由器。', 409);
  const devices = await client.listDevices();
  if (router !== client) throw new AppError('路由器配置已变更，请刷新列表。', 409);
  remember(devices);
  return devices;
}

function selectedDevice(value, rule) {
  const mac = normalizeMac(value);
  return knownDevices.get(mac) || ruleDevices(rule).find(device => device.mac === mac);
}

function checkDevices() {
  if (checking || !router) return;
  const now = new Date();
  const due = [...detectors.values()].filter(detector => detector.due(now));
  if (!due.length) return;
  for (const detector of due) detector.lastCheckedAt = now.valueOf();
  const client = router;
  checking = (async () => {
    let devices;
    try {
      devices = await client.listDevices();
    } catch (error) {
      if (client === router) {
        const message = error instanceof AppError ? error.message : '无法完成本次检测。';
        for (const detector of due) detector.error(new Date(), message);
      }
      return;
    }
    if (client !== router) return;
    remember(devices);
    const online = new Set(devices.map(device => device.mac));
    const at = new Date();
    const current = due.filter(detector => detectors.get(detector.rule.id) === detector);
    const triggered = current.filter(detector => detector.observe(online, at));
    const away = new Set(current.filter(detector => detector.lastResult?.departure === 'away').map(detector => detector.rule.id));
    const resolved = event => !event.resolvedAt && away.has(event.ruleId) && event.actions.includes('notify');
    if (triggered.length || events.some(resolved)) {
      const results = triggered.map(({ rule, matched }) => {
        const device = latestDevice(rule.trigger.device);
        return {
          id: randomUUID(), ruleId: rule.id, name: rule.name, at: at.toISOString(),
          device, state: rule.trigger.state, actions: rule.actions,
          deliveries: (rule.channelIds || []).map(id => ({ id, name: settings.channels.find(c => c.id === id)?.name || '已删除渠道', status: 'pending' })),
          message: noticeFor({ device, state: rule.trigger.state }, matched.map(condition => ({
            ...condition, device: latestDevice(condition.device),
          })), rule.noticeText),
        };
      });
      await enqueue(async () => {
        const history = events.map(event => resolved(event) ? { ...event, resolvedAt: at.toISOString() } : event);
        const next = [...results, ...history].filter((event, index) => index < 100 ||
          event.deliveries?.some(d => ['pending', 'sending'].includes(d.status)));
        await writeJson(eventsPath, next);
        events = next;
      });
    }
  })().catch(error => {
    console.error('Detection failed:', error.code || error.name);
  }).finally(() => { checking = null; });
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') {
    throw new AppError('请求必须使用 JSON。', 415);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > 8192) {
      req.resume();
      throw new AppError('请求内容过长。', 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('无法读取请求内容。');
  }
}

const adminOnly = () => new AppError('请使用飞牛管理员账号打开应用。', 403);

async function api(req, res, route) {
  if (packageSocket && (req.headers['x-trim-isadmin'] !== 'true'
      || !/^\d+$/.test(req.headers['x-trim-userid'] || ''))) throw adminOnly();
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    throw new AppError('请从应用页面操作。', 403);
  }
  const request = `${req.method} ${route}`;
  switch (request) {
    case 'GET /api/state':
      return json(res, 200, state());
    case 'GET /api/devices':
      return json(res, 200, { devices: await listDevices() });
    case 'PUT /api/channels':
    case 'DELETE /api/channels': {
      const input = await bodyJson(req);
      await enqueue(async () => {
        const previous = settings.channels.find(c => c.id === input.id);
        if (input.id && !previous) throw new AppError('渠道不存在。', 404);
        let channels;
        if (req.method === 'DELETE') {
          if (!previous) throw new AppError('请选择渠道。');
          if (settings.rules.some(r => r.channelIds?.includes(input.id))) throw new AppError('请先修改引用此渠道的规则。', 409);
          channels = settings.channels.filter(c => c.id !== input.id);
        } else {
          const channel = channelConfig(input, previous);
          if (settings.channels.some(c => c.id !== channel.id && c.name === channel.name)) throw new AppError('渠道名称已存在。');
          channels = previous ? settings.channels.map(c => c.id === previous.id ? channel : c) : [...settings.channels, channel];
        }
        await saveSettings({ ...settings, channels });
      });
      return json(res, 200, state());
    }
    case 'POST /api/channels/test': {
      const { id } = await bodyJson(req);
      const channel = await enqueue(async () => {
        const target = settings.channels.find(c => c.id === id);
        if (!target) throw new AppError('渠道不存在。', 404);
        await countRequest(target);
        return target;
      });
      await sendNotification(channel, '离网自动化 · 渠道测试', '这是来自飞牛应用的测试通知。');
      return json(res, 200, state());
    }
    case 'PUT /api/router': {
      const config = routerSettings(await bodyJson(req));
      const devices = await enqueue(async () => {
        const client = new RouterClient(config);
        const result = await client.listDevices();
        const sameNetwork = !settings.router || settings.router.host === config.host;
        const rules = sameNetwork ? settings.rules : settings.rules.map(rule => ({ ...rule, enabled: false }));
        const changed = { ...settings, router: config, rules };
        await writeJson(configPath, changed);
        settings = changed;
        router = client;
        detectors = new Map(rules.map(rule => [rule.id, new RuleDetector(rule, calendar)]));
        if (!sameNetwork) knownDevices.clear();
        remember(result);
        return result;
      });
      return json(res, 200, { ...state(), devices });
    }
    case 'PUT /api/rules': {
      const value = await bodyJson(req);
      await enqueue(async () => {
        if (!router) throw new AppError('请先连接路由器。', 409);
        const current = settings.rules.find(rule => rule.id === value?.id);
        if (value?.id && !current) throw new AppError('规则不存在，请刷新后重试。', 404);
        if (!current && settings.rules.length >= 32) throw new AppError('最多可以保存 32 条规则。');
        if (!Array.isArray(value?.channelIds) || !value.channelIds.length ||
            value.channelIds.some(id => !settings.channels.some(c => c.id === id))) {
          throw new AppError('请先配置通知渠道，并至少选择一个有效渠道。');
        }
        const changedRule = ruleSettings({ ...value, actions: ['record'] }, current?.id || randomUUID(), mac => selectedDevice(mac, current));
        changedRule.channelIds = [...new Set(value.channelIds)];
        const rules = current ? settings.rules.map(rule => rule.id === current.id ? changedRule : rule)
          : [...settings.rules, changedRule];
        const changed = { ...settings, rules };
        await writeJson(configPath, changed);
        settings = changed;
        detectors.set(changedRule.id, new RuleDetector(changedRule, calendar));
      });
      return json(res, 200, state());
    }
    case 'DELETE /api/rules': {
      const value = await bodyJson(req);
      await enqueue(async () => {
        const rules = settings.rules.filter(rule => rule.id !== value?.id);
        if (rules.length === settings.rules.length) throw new AppError('找不到要删除的规则。', 404);
        const changed = { ...settings, rules };
        await writeJson(configPath, changed);
        settings = changed;
        detectors.delete(value.id);
      });
      return json(res, 200, state());
    }
    case 'DELETE /api/events': {
      await bodyJson(req);
      await enqueue(async () => {
        const next = events.flatMap(event => {
          if (event.deliveries?.some(d => ['pending', 'sending'].includes(d.status))) return [{ ...event, recordCleared: true }];
          if (!event.actions.includes('record')) return [event];
          if (event.actions.includes('notify') && !event.resolvedAt) return [{ ...event, recordCleared: true }];
          return [];
        });
        await writeJson(eventsPath, next);
        events = next;
      });
      return json(res, 200, state());
    }
    case 'POST /api/notices/ack': {
      const { id } = await bodyJson(req);
      if (typeof id !== 'string' || !id) throw new AppError('请选择要确认的提醒。');
      await enqueue(async () => {
        if (!events.some(e => e.id === id && !e.resolvedAt && e.actions.includes('notify'))) return;
        const next = events.map(e => e.id === id ? { ...e, resolvedAt: new Date().toISOString() } : e);
        await writeJson(eventsPath, next);
        events = next;
      });
      return json(res, 200, state());
    }
    case 'POST /api/calendar':
      await bodyJson(req);
      await calendar.update();
      return json(res, 200, state());
    default:
      throw new AppError('接口不存在。', 404);
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

const server = createServer({ requestTimeout: 30000 }, async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const route = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
    if (route.startsWith('/api/')) return await api(req, res, route);
    if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('请求方法不支持。', 405);
    if (route === '/healthz') return json(res, 200, { ok: true });
    if ((!packageSocket && pathname === '/') || pathname === prefix) {
      res.writeHead(302, { Location: `${prefix}/` });
      return res.end();
    }
    const filename = route === '/' ? 'index.html' : route.slice(1);
    if (!/^(?:index\.html|icon\.png|assets\/[\w.-]+)$/.test(filename) || !mime[extname(filename)]) {
      throw new AppError('页面不存在。', 404);
    }
    const content = await readFile(join(webDir, filename));
    res.writeHead(200, {
      'Content-Type': mime[extname(filename)],
      'Cache-Control': filename.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'GET' ? content : undefined);
  } catch (error) {
    if (error instanceof AppError) return json(res, error.status, { error: error.message });
    if (error.code === 'ENOENT') return json(res, 404, { error: '找不到页面资源。请重新构建或安装应用。' });
    console.error('Request failed:', error.code || error.name);
    return json(res, 500, { error: '应用无法完成请求，请检查服务日志。' });
  }
});

if (packageSocket) {
  await unlink(packageSocket).catch(error => { if (error.code !== 'ENOENT') throw error; });
  server.listen(packageSocket);
} else {
  server.listen(port, '127.0.0.1', () => console.info(`http://127.0.0.1:${port}${prefix}/`));
}

const schedule = setInterval(() => { checkDevices(); void dispatchPending(); }, 1000);
calendar.update();
const holidays = setInterval(() => calendar.update(), 86400000);

function shutdown() {
  clearInterval(schedule);
  clearInterval(holidays);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
