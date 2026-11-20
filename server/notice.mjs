const legacyTemplate = '触发设备已离线，条件设备仍在线，请检查是否有设备遗落。';
const states = { online: '在线', offline: '离线', still_online: '仍在线', still_offline: '仍离线' };

export function customNotice(text) {
  return text === legacyTemplate ? '' : text || '';
}

export function noticeFor(trigger, conditions, customText) {
  if (customNotice(customText)) return customText;
  const parts = [`${trigger.device.name} 已${trigger.state === 'online' ? '上线' : '离线'}`];
  for (const condition of conditions) {
    parts.push(`${condition.device.name} ${states[condition.state]}`);
  }
  const leftBehind = conditions.filter(item => item.state === 'still_online' || item.state === 'online');
  if (trigger.state === 'offline' && leftBehind.length) {
    parts.push(`请确认是否带上了 ${leftBehind.map(item => item.device.name).join('、')}`);
  }
  return parts.join('，') + '。';
}

export function historicalMessage(event) {
  if (event.message !== legacyTemplate || !event.device?.name) return event;
  // Old events only recorded the trigger. The rule may have changed since then.
  return { ...event, message: noticeFor({ device: event.device, state: event.state }, []) };
}
