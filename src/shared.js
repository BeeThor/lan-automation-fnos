import { TrimApp } from '@trimjs/web-app';

export const base = import.meta.env.BASE_URL;

export async function api(path, method = 'GET', body, signal) {
  const response = await fetch(base + 'api/' + path, {
    method, signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || '应用服务暂不可用，请刷新后重试。');
  return result;
}

const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const formatTime = iso => iso ? dateTime.format(new Date(iso)) : '—';

export function watchTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  let stopped = false;
  let sdk;
  const apply = theme => {
    if (!stopped && (theme === 'dark' || theme === 'light')) {
      document.body.setAttribute('theme-mode', theme);
    }
  };
  const system = () => apply(query.matches ? 'dark' : 'light');
  system();
  query.addEventListener('change', system);
  if (window.parent !== window) {
    sdk = new TrimApp();
    sdk.getPlatformConfig().then(config => {
      if (config?.theme) query.removeEventListener('change', system);
      apply(config?.theme);
    }).catch(() => {});
    sdk.$on('os/theme', apply).catch(() => {});
  }
  return () => {
    stopped = true;
    query.removeEventListener('change', system);
    sdk?.$off('os/theme', apply).catch(() => {});
  };
}

export function dayLabel(days) {
  return days === 'workdays' ? '工作日（含调休）' : '每天';
}

export const triggerOptions = [
  { value: 'offline', label: '从在线变为离线' },
  { value: 'online', label: '从离线变为在线' },
];

export const conditionOptions = [
  { value: 'still_online', label: '触发前后仍在线' },
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'still_offline', label: '触发前后仍离线' },
];

export const actionLabels = { notify: '应用内提醒', record: '写入运行记录' };
