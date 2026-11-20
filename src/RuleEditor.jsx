import React, { useState } from 'react';
import { Banner, Button, Checkbox, Input, InputNumber, Pagination, Select, Steps, Switch, TimePicker, Tooltip } from '@douyinfe/semi-ui';
import {
  IconAlertTriangle, IconChevronLeft, IconDelete, IconPlus, IconRefresh,
} from '@douyinfe/semi-icons';
import { conditionOptions, triggerOptions } from './shared';
import { useFittedPage } from './useFittedPage';
import { DeviceIcon } from './DeviceIcon';
import { noticeFor } from '../server/notice.mjs';

let nextRow = 1;
const row = values => ({ ...values, key: nextRow++ });
const newRange = () => row({ start: '07:00', end: '09:00' });
const newCondition = () => row({ mac: '', state: 'still_online' });

function draftFor(rule, example, channels) {
  if (rule) {
    return {
      ...rule, channelIds: rule.channelIds || [],
      trigger: { mac: rule.trigger.device.mac, state: rule.trigger.state },
      conditions: rule.conditions.map(item => row({ mac: item.device.mac, state: item.state })),
      ranges: rule.ranges.map(row),
    };
  }
  return {
    name: example ? '设备遗落提醒' : '', enabled: true,
    trigger: { mac: '', state: 'offline' },
    conditions: example ? [newCondition()] : [],
    match: 'all', days: 'workdays', ranges: [newRange()], confirmations: 2,
    intervalSeconds: 10, channelIds: channels.length === 1 ? [channels[0].id] : [],
    noticeText: '',
  };
}

const steps = ['触发', '条件', '生效时间', '通知'];
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = value => [Math.floor(value / 60), value % 60].map(n => String(n).padStart(2, '0')).join(':');

function TimeRange({ item, index, update, remove, only }) {
  const start = minutes(item.start);
  const end = minutes(item.end);
  const overnight = end < start;
  const duration = (end - start + 1440) % 1440;
  function changeStart(value) {
    if (!value) return;
    const next = minutes(value);
    let finish = end;
    if (next === 1439 && !overnight) {
      finish = (next + duration) % 1440;
    } else if (overnight && next > 0) {
      if (finish >= next) finish = Math.min(next - 1, (next + duration) % 1440);
    } else if (finish <= next) {
      finish = Math.min(1439, next + duration);
    }
    update({ start: value, end: clock(finish) });
  }
  const validEnd = value => overnight ? value < start : value > start;
  const hour = Math.floor(start / 60);
  return (
    <div className="time-row">
      <TimePicker format="HH:mm" value={item.start} showClear={false} onChangeWithDateFirst={false}
        aria-label={`时段 ${index + 1} 开始`} onChange={changeStart} />
      <span className="muted">至</span>
      <TimePicker format="HH:mm" value={item.end} showClear={false} onChangeWithDateFirst={false}
        aria-label={`时段 ${index + 1} 结束`}
        disabledHours={() => Array.from({length: 24}, (_, h) => h).filter(h => overnight ? h * 60 >= start : h * 60 + 59 <= start)}
        disabledMinutes={h => h === hour ? Array.from({length: 60}, (_, m) => m).filter(m => !validEnd(h * 60 + m)) : []}
        onChange={value => { if (value && validEnd(minutes(value))) update({ end: value }); }} />
      <Checkbox checked={overnight} disabled={start === 0 || start === 1439}
        onChange={e => update({ end: clock(e.target.checked ? Math.min(start - 1, 60) : Math.min(1439, start + 60)) })}>次日</Checkbox>
      <Button htmlType="button" theme="borderless" type="tertiary" icon={<IconDelete />} aria-label={`删除时段 ${index + 1}`}
        disabled={only} onClick={remove} />
    </div>
  );
}

function stepError(index, draft) {
  if (index === 0) {
    if (!draft.name.trim()) return '请填写规则名称。';
    if (!draft.trigger.mac) return '请选择触发设备。';
  }
  if (index === 1) {
    const macs = [draft.trigger.mac, ...draft.conditions.map(item => item.mac)];
    if (macs.includes('')) return '请为每条条件选择设备，或删除空条件。';
    if (new Set(macs).size !== macs.length) return '同一条规则中请选择不同的设备。';
  }
  if (index === 2) {
    if (draft.ranges.some(r => !r.start || !r.end || r.start === r.end)) return '请填写不同的起止时间。';
    if (!Number.isInteger(draft.intervalSeconds) || draft.intervalSeconds < 1 || draft.intervalSeconds > 300) return '检测间隔须为 1 至 300 秒。';
    if (!Number.isInteger(draft.confirmations) || draft.confirmations < 1 || draft.confirmations > 10) return '连续确认须为 1 至 10 次。';
  }
  if (index === 3 && !draft.channelIds.length) return '请至少选择一个通知渠道。';
  return '';
}

function Section({ title, children, extra }) {
  return (
    <section className="form-section">
      <div className="section-title">
        <h3>{title}</h3>
        {extra && <div className="section-extra">{extra}</div>}
      </div>
      <div className="section-content">{children}</div>
    </section>
  );
}

export function RuleEditor({ channels, rule, example, devices, refreshing, refresh, save, cancel }) {
  const [draft, setDraft] = useState(() => draftFor(rule, example, channels));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const savedDevices = [rule?.trigger.device, ...(rule?.conditions || []).map(item => item.device)].filter(Boolean);
  const details = new Map([...savedDevices, ...devices].map(device => [device.mac, device]));

  function deviceField(mac, onChange, label) {
    const options = [...details.values()].map(device => ({
      value: device.mac, label: `${device.name} · ${device.ip || '—'} · ${device.mac}`,
    }));
    return (
      <Select
        className="device-picker"
        aria-label={label} placeholder={label} value={mac || undefined} onChange={onChange}
        dropdownClassName="device-options"
        renderSelectedItem={item => <span title={item.label}>{details.get(item.value)?.name || item.label}</span>}
        optionList={options} filter motion={false} emptyContent="没有匹配的在线设备" prefix={<DeviceIcon aria-hidden="true" />}
      />
    );
  }

  const conditions = useFittedPage(draft.conditions.length, { reserve: 102 });
  const ranges = useFittedPage(draft.ranges.length, { reserve: 72 });
  function addRow(field, item, list) {
    list.select(draft[field].length);
    set(field, [...draft[field], item]);
  }

  const named = item => ({ ...item, device: { name: details.get(item.mac)?.name || '所选设备' } });
  const preview = noticeFor(named(draft.trigger), draft.conditions.map(named), draft.noticeText);

  function navigate(target) {
    if (target > step) {
      for (let i = 0; i < target; i++) {
        const message = stepError(i, draft);
        if (message) { setStep(i); setError(message); return; }
      }
    }
    setStep(target);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (step < 3) { navigate(step + 1); return; }
    const invalid = steps.findIndex((_, i) => stepError(i, draft));
    if (invalid >= 0) { setStep(invalid); setError(stepError(invalid, draft)); return; }
    setError('');
    setSaving(true);
    try {
      await save(draft);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  const updateRow = (key, id, values) => setDraft(current => ({
    ...current, [key]: current[key].map(item => item.key === id ? { ...item, ...values } : item),
  }));

  return (
    <form className="rule-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <Tooltip content="返回自动化"><Button htmlType="button" theme="borderless" type="tertiary" icon={<IconChevronLeft />}
            aria-label="返回自动化" onClick={cancel} /></Tooltip>
          <h2>{rule ? '编辑规则' : '新建规则'}</h2>
        </div>
        {step < 2 && <Button htmlType="button" type="tertiary" theme="borderless" icon={<IconRefresh />} loading={refreshing} onClick={refresh}>刷新设备</Button>}
      </div>
      <nav className="step-track" aria-label="规则步骤">
        <Steps type="basic" size="small" hasLine={false} current={step} onChange={saving ? undefined : navigate}>
          {steps.map(title => <Steps.Step key={title} role="button" title={title} aria-label={title} />)}
        </Steps>
      </nav>
      <div className="editor-scroll" key={step}>
        <div className="editor-fields">
        {step === 0 && <>
        <div className="editor-name">
          <label htmlFor="rule-name">规则名称</label>
          <Input id="rule-name" value={draft.name} onChange={value => set('name', value)}
            placeholder="例如 上班时的遗落提醒" maxLength={40} />
          <label className="enable-toggle">
            <Switch checked={draft.enabled} onChange={value => set('enabled', value)} />
            启用
          </label>
        </div>
        <Section title="当设备状态变化时">
          <div className="input-pair">
            {deviceField(draft.trigger.mac, mac => set('trigger', { ...draft.trigger, mac }), '选择触发设备')}
            <Select value={draft.trigger.state} optionList={triggerOptions}
              aria-label="触发状态" onChange={state => set('trigger', { ...draft.trigger, state })} />
          </div>
        </Section>
        </>}
        {step === 1 && <Section title="满足以下条件时" extra={draft.conditions.length > 1 && (
          <Select size="small" value={draft.match} aria-label="条件匹配方式" onChange={value => set('match', value)}
            optionList={[{ value: 'all', label: '全部满足' }, { value: 'any', label: '任一满足' }]} />
        )}>
          <div className="condition-list" ref={conditions.listRef}>{conditions.slice(draft.conditions).map((item, index) => (
            <div className="repeat-row" key={item.key}>
              {deviceField(item.mac, mac => updateRow('conditions', item.key, { mac }), `选择条件设备 ${conditions.start + index + 1}`)}
              <Select value={item.state} optionList={conditionOptions} aria-label={`条件状态 ${conditions.start + index + 1}`}
                onChange={state => updateRow('conditions', item.key, { state })} />
              <Button htmlType="button" theme="borderless" icon={<IconDelete />} aria-label={`删除条件 ${conditions.start + index + 1}`}
                onClick={() => set('conditions', draft.conditions.filter(condition => condition.key !== item.key))} />
            </div>
          ))}</div>
          {!draft.conditions.length && <p className="muted">可以添加其他设备的在线或离线状态作为条件。</p>}
          <div className="list-controls"><Button htmlType="button" icon={<IconPlus />} disabled={draft.conditions.length >= 8}
            onClick={() => addRow('conditions', newCondition(), conditions)}>添加条件</Button><Pagination {...conditions.pager} /></div>
        </Section>}
        {step === 2 && <section className="form-section schedule-card">
          <header className="schedule-heading"><h3>生效时间</h3><span>北京时间</span></header>
          <div className="schedule-settings">
            <label><span>重复日期</span><Select aria-label="生效日期" value={draft.days} onChange={value => set('days', value)}
              optionList={[{ value: 'workdays', label: '工作日（含调休）' }, { value: 'all', label: '每天' }]} /></label>
            <label><span>检测间隔</span><InputNumber aria-label="检测间隔" value={draft.intervalSeconds} onChange={value => set('intervalSeconds', value)}
              min={1} max={300} suffix="秒" /></label>
            <label><span>连续确认</span><InputNumber aria-label="确认次数" value={draft.confirmations} onChange={value => set('confirmations', value)}
              min={1} max={10} suffix="次" /></label>
          </div>
          <div className="range-heading"><h3>检测时段</h3>
            <Button htmlType="button" theme="borderless" size="small" icon={<IconPlus />} disabled={draft.ranges.length >= 12}
              onClick={() => addRow('ranges', row({ start: '17:00', end: '19:00' }), ranges)}>添加时段</Button>
          </div>
          <div className="range-list" ref={ranges.listRef}>{ranges.slice(draft.ranges).map((item, offset) => (
            <TimeRange key={item.key} item={item} index={ranges.start + offset} only={draft.ranges.length === 1}
              update={values => updateRow('ranges', item.key, values)}
              remove={() => set('ranges', draft.ranges.filter(range => range.key !== item.key))} />
          ))}</div>
          <div className="range-count"><span>共 {draft.ranges.length} 个时段</span><Pagination {...ranges.pager} /></div>
        </section>}
        {step === 3 && <Section title="通知渠道">
          <Select multiple maxTagCount={2} className="channel-select" aria-label="接收通知的渠道"
            value={draft.channelIds} placeholder="选择一个或多个通知渠道"
            optionList={channels.map(c => ({ value: c.id, label: c.name }))}
            onChange={ids => set('channelIds', ids)} />
              <Input aria-label="自定义提醒内容" placeholder="自定义提醒内容（留空时自动填入设备名）" value={draft.noticeText}
                onChange={value => set('noticeText', value)} maxLength={200} />
              <div className="notice-preview"><strong>提醒预览</strong><p>{preview}</p>
                {draft.match === 'any' && draft.conditions.length > 1 && !draft.noticeText && <small>实际提醒仅包含触发时满足的条件设备。</small>}
              </div>
        </Section>}
      </div>
      </div>
      {error && <Banner type="danger" icon={<IconAlertTriangle />} description={error} closeIcon={null} />}
      <div className="editor-footer">
        <Button htmlType="button" disabled={saving} onClick={step ? () => navigate(step - 1) : cancel}>{step ? '上一步' : '取消'}</Button>
        <Button htmlType="submit" type="primary" theme="solid" loading={saving}>{step === 3 ? '保存规则' : '下一步'}</Button>
      </div>
    </form>
  );
}
