import React, { useState } from 'react';
import { Button, Dropdown, Modal, Input, Pagination, Select, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { IconBellStroked, IconChevronRight, IconClose, IconFlowChartStroked, IconMore, IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useFittedPage } from './useFittedPage';
import { actionLabels, conditionOptions, dayLabel, formatTime } from './shared';

const statusLabels = {
  error: '检测失败', watching: '监测中', awaiting_transition: '等待状态变化',
  conditions_unmet: '条件未满足', confirming: '连续确认中', executed: '已执行',
  away: '已离家', confirming_away: '正在确认离家',
};

const schedule = rule => rule.ranges.map(r => r.start + '–' + (r.end < r.start ? '次日 ' : '') + r.end).join('、');

function DeviceState({ online }) {
  if (online == null) return null;
  return <span className="device-state" data-online={online}>{online ? '在线' : '离线'}</span>;
}

function RuleCard({ rule, channels, expanded, toggle, count, showNotices, edit, remove }) {
  const { active, result } = rule.status;
  const mode = result?.departure || result?.mode;
  const state = !rule.enabled ? '已停用' : !active ? '时段外' : statusLabels[mode] || '等待检测';
  const color = !rule.enabled || !active || !mode ? 'grey' : mode === 'error' ? 'red' : mode === 'away' ? 'green' : 'blue';
  const devices = [rule.trigger.device, ...rule.conditions.map(item => item.device)];
  const details = [
    ['触发设备', rule.trigger.device.name + (rule.trigger.state === 'online' ? ' 上线时' : ' 离线时'), result?.triggerOnline],
    ...rule.conditions.map((condition, index) => [
      rule.match === 'all' ? '条件（且）' : '条件（或）',
      condition.device.name + ' ' + conditionOptions.find(option => option.value === condition.state)?.label, result?.conditionOnline?.[index],
    ]),
    ['重复日期', dayLabel(rule.days)],
    ...rule.ranges.map((range, index) => ['时段 ' + (index + 1), schedule({ ranges: [range] })]),
    ['通知渠道', rule.channelIds?.map(id => channels.find(c => c.id === id)?.name).join('、') || '未配置手机推送'],
    ['执行动作', rule.actions.map(action => actionLabels[action]).join('、')],
  ];
  return <article className="rule-card" id={'rule-' + rule.id}>
    <header className="rule-head">
      <h3>{rule.name}</h3><Tag color={color}>{state}</Tag>
      <Dropdown trigger="click" position="bottomRight" render={<Dropdown.Menu>
        <Dropdown.Item onClick={edit}>编辑规则</Dropdown.Item>
        <Dropdown.Item type="danger" onClick={remove}>删除规则</Dropdown.Item>
      </Dropdown.Menu>}>
        <Button type="tertiary" theme="borderless" aria-label={rule.name + '的更多操作'} icon={<IconMore />} />
      </Dropdown>
    </header>
    <p className="rule-schedule">{dayLabel(rule.days)}<span>·</span>{schedule({...rule, ranges: rule.ranges.slice(0, 1)})}
      {rule.ranges.length > 1 && ` 等 ${rule.ranges.length} 个时段`}</p>
    <ul className="device-pairs" aria-label="最近检测到的设备状态">
      {devices.slice(0, 2).map((device, index) => {
        const online = index === 0 ? result?.triggerOnline : result?.conditionOnline?.[index - 1];
        return <li key={device.mac}><div className="device-role">{index === 0 ? '触发设备' : '条件设备'}</div>
          <div className="device-value"><strong>{device.name}</strong>
            <DeviceState online={online} />
          </div></li>;
      })}
    </ul>
    {result?.message && <p className="rule-error">{result.message}</p>}
    {expanded && <RuleDetails rows={details} id={'detail-' + rule.id} title={rule.name} close={toggle} />}
    <footer className="rule-card-footer">
      <Button size="small" type="tertiary" theme="borderless" aria-haspopup="dialog" icon={<IconChevronRight size="small" />} onClick={toggle}>
        {devices.length > 2 ? `规则详情（另 ${devices.length - 2} 台）` : '规则详情'}
      </Button>
      {count > 0 && <Button size="small" theme="borderless" icon={<IconBellStroked size="small"/>} onClick={showNotices}>{count} 条提醒</Button>}
      {result?.at && <time className="checked-at" dateTime={result.at}>上次检测 {formatTime(result.at)}</time>}
    </footer>
  </article>;
}

function RuleDetails({ rows, id, title, close }) {
  const list = useFittedPage(rows.length, { reserve: 0, useMaxHeight: true });
  const header = <div className="detail-header">
    <h3 id={id + '-title'} title={title}>{title}</h3>
    <Pagination className="detail-pager" {...list.pager} />
    <Button size="small" theme="borderless" type="tertiary" aria-label="关闭" icon={<IconClose />} onClick={close} />
  </div>;
  return <Modal className="rule-details-modal" header={header} aria-label={title} visible centered onCancel={close} footer={null}>
    <div className="detail-sheet" id={id} data-paged={rows.length > list.capacity}>
      <dl className="detail-rows" ref={list.listRef}>{list.slice(rows).map(([label, value, online], index) =>
        <div key={list.start + index}><dt>{label}</dt><dd><span>{value}</span><DeviceState online={online} /></dd></div>)}</dl>
    </div>
  </Modal>;
}

export function Rules({ rules, channels, create, edit, remove, notices, acknowledge }) {
  const [view, setView] = useState('rules');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  const newest = [...rules].reverse();
  const term = query.trim().toLowerCase();
  const matches = newest.filter(rule => [rule.name, rule.trigger.device.name, ...rule.conditions.map(c => c.device.name)]
    .some(text => text.toLowerCase().includes(term)));
  const selected = byId.has(filter) ? filter : '';
  const visible = notices.filter(e => !selected || e.ruleId === selected);
  const cards = useFittedPage(matches.length, { columns: 'grid', resetKey: query });
  const messages = useFittedPage(visible.length, { resetKey: selected });
  function openNotices(id) { setFilter(id); messages.select(0); setView('notices'); }
  function openRule(id) {
    setQuery(''); cards.select(newest.findIndex(r => r.id === id));
    setExpanded(id); setView('rules');
  }
  return <section className="rules">
    <Tabs type="line" tabPaneMotion={false} activeKey={view} onChange={setView} tabBarExtraContent={view === 'rules' &&
      <Button theme="solid" icon={<IconPlus />} onClick={() => create(false)}>新建规则</Button>
    }>
      <Tabs.TabPane itemKey="rules" tab={`规则  ${rules.length}`}>
        {rules.length > 0 ? <>
          {(rules.length > 1 || query) && <Input className="rule-search" prefix={<IconSearch />} placeholder="搜索规则或设备" aria-label="搜索规则或设备" showClear
            value={query} onChange={v => { setQuery(v); cards.select(0); }} />}
          <div className="rule-grid" ref={cards.listRef}>{cards.slice(matches).map(rule => <RuleCard key={rule.id} channels={channels} rule={rule}
            expanded={expanded === rule.id} toggle={() => setExpanded(expanded === rule.id ? null : rule.id)}
            count={notices.filter(e => e.ruleId === rule.id).length} showNotices={() => openNotices(rule.id)}
            edit={() => edit(rule)} remove={() => remove(rule)} />)}</div>
          {!matches.length && <p className="table-empty">没有匹配的规则或设备</p>}
          <Pagination className="rule-pager" {...cards.pager} />
        </> : <section className="template-group"><h3>从模板创建</h3><div className="preset">
          <IconFlowChartStroked className="network-mark" size="large" aria-hidden="true" />
          <div className="preset-copy">
            <h3>设备遗落提醒</h3>
          <p className="muted">一台设备离网、另一台仍在线时提醒。</p>
          </div>
          <Button theme="outline" type="tertiary" onClick={() => create(true)}>使用模板</Button>
        </div></section>}
      </Tabs.TabPane>
      {(notices.length > 0 || view === 'notices') && <Tabs.TabPane itemKey="notices" tab={`提醒  ${notices.length}`}>
        <Select aria-label="筛选提醒规则" className="notice-filter" value={selected || 'all'}
          optionList={[{ value: 'all', label: '全部规则' }, ...rules.map(r => ({
            value: r.id, label: rules.some(other => other.id !== r.id && other.name === r.name)
              ? r.name + ' · ' + r.trigger.device.name : r.name,
          }))]}
          onChange={value => { setFilter(value === 'all' ? '' : value); messages.select(0); }} />
        {visible.length ? <ol className="notice-list" ref={messages.listRef}>{messages.slice(visible).map(event => <li key={event.id}>
          <div className="notice-copy"><header>
            <Button className="notice-source" type="tertiary" theme="borderless" size="small"
              aria-label={'查看规则 ' + event.name} onClick={() => openRule(event.ruleId)}>{event.name}<IconChevronRight size="small" /></Button>
            <time dateTime={event.at}>{formatTime(event.at)}</time>
          </header><Typography.Paragraph>{event.message}</Typography.Paragraph></div>
          <Button size="small" type="tertiary" theme="outline" onClick={() => acknowledge(event.id)}>已知晓</Button>
        </li>)}</ol> : <p className="table-empty">{selected ? '这条规则当前没有提醒' : '当前没有提醒'}</p>}
        <Pagination className="rule-pager" {...messages.pager} />
      </Tabs.TabPane>}
    </Tabs>
  </section>;
}
