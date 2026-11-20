import { matchingWindows } from './calendar.mjs';

function conditionMatches(condition, online, baseline) {
  const mac = condition.device.mac;
  switch (condition.state) {
    case 'online': return online.has(mac);
    case 'offline': return !online.has(mac);
    case 'still_online': return baseline.has(mac) && online.has(mac);
    case 'still_offline': return !baseline.has(mac) && !online.has(mac);
    default: return false;
  }
}

export class RuleDetector {
  constructor(rule, calendar) {
    this.rule = rule;
    this.calendar = calendar;
    this.windows = [];
    this.baseline = null;
    this.samples = 0;
    this.awaySamples = 0;
    this.lastCheckedAt = 0;
    this.lastResult = null;
  }

  due(now) {
    const windows = matchingWindows(this.rule, this.calendar, now);
    if (!windows.some(window => this.windows.includes(window))) {
      this.baseline = null;
      this.samples = 0;
      this.lastCheckedAt = 0;
      this.awaySamples = 0;
      if (windows.length) this.lastResult = null;
    }
    this.windows = windows;
    return windows.length > 0 && now.valueOf() - this.lastCheckedAt >= this.rule.intervalSeconds * 1000;
  }

  error(now, message) {
    this.baseline = null;
    this.samples = 0;
    this.awaySamples = 0;
    this.lastResult = { mode: 'error', at: now.toISOString(), message };
  }

  observe(online, now) {
    const windows = matchingWindows(this.rule, this.calendar, now);
    if (!windows.some(window => this.windows.includes(window))) return false;
    const { trigger, conditions, confirmations } = this.rule;
    const away = trigger.state === 'offline' && !online.has(trigger.device.mac) && conditions.length > 0
      && conditions.every(item => ['online', 'still_online'].includes(item.state) && !online.has(item.device.mac));
    this.awaySamples = away ? Math.min(confirmations, this.awaySamples + 1) : 0;
    const mode = this.evaluate(online);
    this.lastResult = {
      mode, at: now.toISOString(), samples: this.samples,
      triggerOnline: online.has(trigger.device.mac),
      conditionOnline: conditions.map(item => online.has(item.device.mac)),
      departure: away ? (this.awaySamples >= confirmations ? 'away' : 'confirming_away') : null,
    };
    return mode === 'executed';
  }

  evaluate(online) {
    const { trigger, conditions, match, confirmations } = this.rule;
    const currentlyOnline = online.has(trigger.device.mac);
    if (currentlyOnline !== (trigger.state === 'online')) {
      this.baseline = online;
      this.samples = 0;
      return 'watching';
    }
    if (!this.baseline) return 'awaiting_transition';
    const matched = conditions.filter(condition => conditionMatches(condition, online, this.baseline));
    const allowed = !conditions.length || (match === 'all' ? matched.length === conditions.length : matched.length > 0);
    if (!allowed) {
      this.baseline = null;
      this.samples = 0;
      return 'conditions_unmet';
    }
    this.samples += 1;
    if (this.samples < confirmations) return 'confirming';
    this.matched = matched;
    this.baseline = null;
    this.samples = 0;
    return 'executed';
  }

  state(now) {
    return {
      active: matchingWindows(this.rule, this.calendar, now).length > 0,
      result: this.lastResult,
    };
  }
}
