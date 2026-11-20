import { join } from 'node:path';
import { readJson, writeJson } from './settings.mjs';

const sources = [
  ['GitHub', 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master'],
  ['jsDelivr', 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master'],
];
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const shanghai = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function localClock(now = new Date()) {
  const parts = Object.fromEntries(shanghai.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function isDate(value) {
  if (typeof value !== 'string' || !dayPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseCalendar(year, document) {
  if (document?.year !== year || !Array.isArray(document.days) || !document.days.length
      || !Array.isArray(document.papers) || !document.papers.length) {
    throw new Error('Invalid holiday calendar');
  }
  const days = new Map();
  for (const day of document.days) {
    if (!isDate(day?.date) || typeof day.isOffDay !== 'boolean' || typeof day.name !== 'string') {
      throw new Error('Invalid holiday calendar date');
    }
    days.set(day.date, { workday: !day.isOffDay, name: day.name });
  }
  return days;
}

export class WorkdayCalendar {
  constructor(dataDir, bundledDir, transport = fetch) {
    this.dataDir = join(dataDir, 'calendar');
    this.bundledDir = bundledDir;
    this.transport = transport;
    this.years = new Map();
    this.updateInFlight = null;
    this.results = [];
  }

  relevantYears(now = new Date()) {
    const year = Number(localClock(now).date.slice(0, 4));
    return [year, year + 1];
  }

  async loadYear(year) {
    if (this.years.has(year)) return;
    const cached = await readJson(join(this.dataDir, `${year}.json`), null).catch(() => null);
    if (cached) {
      try {
        this.years.set(year, { days: parseCalendar(year, cached.data), updatedAt: cached.updatedAt });
        return;
      } catch {
        // A damaged cache can be replaced by the bundled calendar or the next download.
      }
    }
    const bundled = await readJson(join(this.bundledDir, `${year}.json`), null).catch(() => null);
    if (bundled) {
      try {
        this.years.set(year, { days: parseCalendar(year, bundled), updatedAt: null });
      } catch {
        // Weekday fallback remains available if this year has no usable data.
      }
    }
  }

  async load(now) {
    const years = this.relevantYears(now);
    await Promise.all([years[0] - 1, ...years].map(year => this.loadYear(year)));
  }

  async updateYear(year, currentYear) {
    const failures = [];
    let missing = 0;
    for (const [name, url] of sources) {
      let data, days;
      try {
        const response = await this.transport(`${url}/${year}.json`, { signal: AbortSignal.timeout(6500) });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) missing++;
          failures.push(`${name} HTTP ${response.status}`);
          continue;
        }
        data = await response.json();
        days = parseCalendar(year, data);
      } catch (error) {
        const reason = error.name === 'TimeoutError' ? '请求超时'
          : error.name === 'TypeError' ? '连接失败' : '数据无效';
        failures.push(name + ' ' + reason);
        continue;
      }
      const updatedAt = new Date().toISOString();
      try {
        await writeJson(join(this.dataDir, `${year}.json`), { data, updatedAt });
      } catch {
        return { year, status: 'failed', reason: '无法写入本地日历缓存' };
      }
      this.years.set(year, { days, updatedAt });
      return { year, status: 'updated' };
    }
    const pending = year > currentYear && missing === sources.length && !this.years.has(year);
    return { year, status: pending ? 'pending' : 'failed', reason: failures.join('、') };
  }

  update(now) {
    if (!this.updateInFlight) {
      const years = this.relevantYears(now);
      this.updateInFlight = Promise.all(years.map(year => this.updateYear(year, years[0])))
        .then(results => {
          this.results = results;
          return this.state(now);
        })
        .finally(() => { this.updateInFlight = null; });
    }
    return this.updateInFlight;
  }

  classify(date) {
    const year = Number(date.slice(0, 4));
    const calendar = this.years.get(year)?.days;
    const adjacent = date.slice(5, 7) === '12' ? this.years.get(year + 1)?.days.get(date) : null;
    const entry = adjacent || calendar?.get(date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      workday: entry?.workday ?? (weekday >= 1 && weekday <= 5),
      name: entry?.name || '',
      source: adjacent || calendar ? 'holiday_calendar' : 'weekday_fallback',
    };
  }

  state(now) {
    const { date } = localClock(now);
    const years = this.relevantYears(now);
    return {
      date,
      ...this.classify(date),
      years: years.filter(year => this.years.has(year)),
      updatedAt: this.years.get(years[0])?.updatedAt || null,
      updates: this.results.filter(item => years.includes(item.year)).map(item => {
        const calendar = this.years.get(item.year);
        return { ...item, local: calendar ? (calendar.updatedAt ? '本地缓存' : '内置日历') : null };
      }),
      failedYears: this.results.filter(item => item.status === 'failed').map(item => item.year),
    };
  }
}

export function matchingWindows(monitor, calendar, now) {
  if (!monitor.enabled) return [];
  const { date, time } = localClock(now);
  const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return monitor.ranges.flatMap(({ start, end }) => {
    if (start < end && (time < start || time >= end)) return [];
    if (start > end && time < start && time >= end) return [];
    const anchor = start > end && time < end ? previousDate : date;
    return monitor.days === 'all' || calendar.classify(anchor).workday
      ? [`${anchor}:${start}-${end}`] : [];
  });
}
