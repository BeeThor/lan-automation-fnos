import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Banner, Button, Input, Modal, Pagination, Spin, Table, Toast, Tooltip } from '@douyinfe/semi-ui';
import {
  IconBellStroked, IconCalendarStroked, IconFlowChartStroked, IconHistory, IconLink,
  IconRefresh, IconSearch, IconSettingStroked,
  IconSignal, IconWifi,
} from '@douyinfe/semi-icons';
import { DeviceIcon } from './DeviceIcon';
import { useFittedPage } from './useFittedPage';
import { Channels } from './Channels';
import { Rules } from './Rules';
import { RuleEditor } from './RuleEditor';
import { actionLabels, api, formatTime, watchTheme } from './shared';

const tabs = [
  { id: 'rules', title: '自动化', icon: <IconFlowChartStroked aria-hidden="true" /> },
  { id: 'devices', title: '在线设备', icon: <DeviceIcon aria-hidden="true" /> },
  { id: 'channels', title: '通知渠道', icon: <IconBellStroked aria-hidden="true" /> },
  { id: 'events', title: '运行记录', icon: <IconHistory aria-hidden="true" /> },
];

function calendarResult({ year, status, reason, local }) {
  if (status === 'updated') return `${year} 年已更新`;
  if (status === 'pending') return `${year} 年数据源尚未提供日历`;
  return `${year} 年${reason}，${local ? '使用' + local : '暂按周一至周五'}`;
}

function RouterForm({ host, save, done, cancel }) {
  const [address, setAddress] = useState(host);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function connect(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await save({ host: address, password });
      setPassword('');
      done();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="router-form" onSubmit={connect} aria-busy={loading}>
      <div className="router-fields">
        <label htmlFor="router-address">路由器地址</label>
        <Input id="router-address" autoComplete="off" value={address}
          onChange={setAddress} placeholder="192.168.1.1" prefix={<IconLink />} />
        <label htmlFor="router-password">管理密码</label>
        <Input id="router-password" type="password" mode="password" autoComplete="off"
          value={password} maxLength={64} onChange={setPassword} placeholder="输入路由器后台的登录密码" />
        {error && <Banner type="danger" description={error} closeIcon={null} />}
      </div>
      <div className="router-actions">
        {cancel && <Button htmlType="button" disabled={loading} onClick={cancel}>取消</Button>}
        <Button type="primary" theme="solid" htmlType="submit" icon={<IconLink />}
          loading={loading} disabled={!password || !address}>连接并获取设备</Button>
      </div>
    </form>
  );
}

function Onboarding({ host, save }) {
  return (
    <div className="connect-card">
      <div className="connect-main">
        <IconWifi className="network-mark" size="extra-large" aria-hidden="true" />
        <h1>连接锐捷路由器</h1>
        <p className="muted">用路由器后台的管理密码登录，读取家里当前联网的设备。</p>
        <RouterForm host={host} save={save} done={() => {}} />
      </div>
      <aside className="connect-aside">
        <h2>连接后可以设置</h2>
        <div><DeviceIcon aria-hidden="true" /><span><strong>选择设备</strong><small>按备注、IP 或 MAC 查找联网设备</small></span></div>
        <div><IconSignal /><span><strong>添加自动化</strong><small>设备状态变化时，检查其他设备是否满足条件</small></span></div>
        <div><IconCalendarStroked aria-hidden="true" /><span><strong>限定生效时间</strong><small>每天或工作日，支持多个时段</small></span></div>
      </aside>
    </div>
  );
}

function SignalReading({ value, delta }) {
  const level = value >= -60 ? 'strong' : value >= -75 ? 'fair' : 'weak';
  const strength = { strong: '强', fair: '中', weak: '弱' }[level];
  const trend = delta == null ? '首次采样' : delta === 0 ? '持平' : delta > 0 ? '增强' : '减弱';
  const change = delta ? `较上次${trend} ${Math.abs(delta)} dB` : trend;
  return <div className="signal-reading" data-level={level}>
    <span className="signal-bars" role="img" aria-label={`信号${strength}`}><i /><i /><i /></span>
    <strong>{value} dBm</strong>
    <small title={change}>{trend}</small>
  </div>;
}

function DeviceList({ devices, fetching, error, refresh, loadedAt }) {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(1);
  const [anchor, setAnchor] = useState(0);
  const tableArea = useRef(null);
  const text = search.trim().toLowerCase();
  const filtered = devices.filter(device => [device.name, device.ip, device.mac].some(value => value.toLowerCase().includes(text)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages - 1, Math.floor(anchor / pageSize));
  useLayoutEffect(() => {
    const area = tableArea.current;
    function measure() {
      const heading = area.querySelector('thead')?.getBoundingClientRect().height || 40;
      const row = area.querySelector('tbody tr[data-row-key]')?.getBoundingClientRect().height || 40;
      const wrapper = area.querySelector('.semi-table-wrapper');
      const scrollbar = wrapper ? wrapper.offsetHeight - wrapper.clientHeight : 0;
      setPageSize(Math.max(1, Math.floor((area.clientHeight - heading - scrollbar - 3) / row)));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [devices, search]);
  const columns = [
    {
      title: '设备备注／名称', dataIndex: 'name',
      render: (name, device) => <div className="device-identity"><span className="device-name"><DeviceIcon aria-hidden="true" /><span title={name}>{name}</span></span>
        <small className="compact-address mono">{device.ip || '—'}<br />{device.mac}</small></div>,
    },
    { title: 'IP 地址', dataIndex: 'ip', className: 'address-column', render: ip => <span className="mono">{ip || '—'}</span> },
    { title: 'MAC 地址', dataIndex: 'mac', className: 'address-column', render: mac => <span className="mono">{mac}</span> },
    { title: 'Wi-Fi 信号', dataIndex: 'rssi', render: (value, device) => {
      if (!Number.isFinite(value)) return <span className="muted">{device.connection === 'wire' ? '有线连接' : '未上报'}</span>;
      return <SignalReading value={value} delta={device.delta} />;
    } },
  ];
  return (
    <section className="panel device-panel">
      <div className="panel-heading">
        <div>
          <h2>在线设备</h2>
          <p className="muted">{devices.length} 台 · 每 5 秒刷新{loadedAt && ` · ${new Date(loadedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}</p>
        </div>
        <Button loading={fetching} icon={<IconRefresh />} onClick={refresh}>刷新设备</Button>
      </div>
      <Input placeholder="搜索备注、IP 或 MAC" aria-label="搜索在线设备" value={search}
        prefix={<IconSearch />} showClear onChange={value => { setSearch(value); setAnchor(0); }} className="device-search" />
      {error && <Banner type="danger" description={error} closeIcon={null} />}
      <div className="device-table-area" ref={tableArea}><Table
        size="middle" columns={columns} dataSource={filtered.slice(page * pageSize, (page + 1) * pageSize)} rowKey="mac" loading={fetching}
        empty={<div className="table-empty">{text ? '没有符合搜索条件的设备' : '当前没有可显示的在线设备'}</div>}
        pagination={false}
      /></div>
      <div className="device-pager">
        <span>{filtered.length ? `${page * pageSize + 1}–${Math.min(filtered.length, (page + 1) * pageSize)} / ${filtered.length} 台` : '0 台'}</span>
        <Pagination size="small" total={filtered.length} pageSize={pageSize} currentPage={page + 1}
          preventPageChangeOnPageSizeChange onPageChange={next => setAnchor((next - 1) * pageSize)} />
      </div>
    </section>
  );
}

function Events({ events, clear }) {
  const data = events.filter(event => event.actions.includes('record') && !event.recordCleared);
  const list = useFittedPage(data.length);
  function confirmClear() {
    Modal.confirm({
      title: '清空运行记录？', content: '已保存的运行记录将被删除，待处理的提醒会保留。',
      okType: 'danger', okText: '清空', cancelText: '取消',
      onOk: async () => {
        try { await clear(); list.select(0); Toast.success('运行记录已清空'); }
        catch (error) { Toast.error(error.message); throw error; }
      },
    });
  }
  return (
    <section className="panel">
      <div className="panel-heading"><h2>运行记录</h2><div className="log-tools">
        <span className="event-count">共 {data.length} 条</span>
        <Button size="small" theme="borderless" type="danger" disabled={!data.length} onClick={confirmClear}>清空记录</Button>
      </div></div>
      {data.length ? <ol ref={list.listRef} className="event-list">
        {list.slice(data).map(event => <li key={event.id}>
          <time dateTime={event.at}>{formatTime(event.at)}</time>
          <div className="event-body">
            <header><h3>{event.name}</h3><div className="event-actions" aria-label="执行动作">
              {event.actions.map(action => <span key={action}>{actionLabels[action] || action}</span>)}
            </div></header>
            <p>{event.message}</p>
            {event.deliveries?.map(item => <small className="delivery-status" key={item.id}>{item.name} · {item.error || ({
              pending: '待发送', sending: '发送中', accepted: '服务已受理', failed: '发送失败', unknown: '发送结果待确认',
            })[item.status]}</small>)}
          </div>
        </li>)}
      </ol> : <div className="table-empty">还没有规则执行记录</div>}
      <Pagination className="rule-pager" {...list.pager} />
    </section>
  );
}

export function App() {
  const [state, setState] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [devices, setDevices] = useState([]);
  const [devicesError, setDevicesError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [updatingCalendar, setUpdatingCalendar] = useState(false);
  const [tab, setTab] = useState('rules');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newRuleKey, setNewRuleKey] = useState(0);
  const readings = useRef(new Map());
  const pendingList = useRef(null);
  const revision = useRef(0);
  function applyChange(next) {
    revision.current++;
    setState(next);
  }

  function setList(list) {
    const now = Date.now();
    const previous = readings.current;
    readings.current = new Map(list.map(device => [device.mac, { rssi: device.rssi, at: now }]));
    setDevices(list.map(device => {
      const last = previous.get(device.mac);
      const comparable = Number.isFinite(last?.rssi) && Number.isFinite(device.rssi) && now - last.at < 20000;
      return { ...device, delta: comparable ? device.rssi - last.rssi : null };
    }));
    setLoadedAt(new Date().toISOString());
    setDevicesError('');
  }

  async function reloadDevices(quiet = false) {
    if (pendingList.current) return;
    const controller = new AbortController();
    pendingList.current = controller;
    if (!quiet) setFetching(true);
    try {
      const data = await api('devices', 'GET', undefined, controller.signal);
      if (!controller.signal.aborted) setList(data.devices);
    } catch (failure) {
      if (failure.name !== 'AbortError') setDevicesError(failure.message);
    } finally {
      if (pendingList.current === controller) { pendingList.current = null; setFetching(false); }
    }
  }

  useEffect(watchTheme, []);
  const watchDevices = state?.router.configured && !editing && tab === 'devices';
  useEffect(() => {
    if (!watchDevices) return;
    function sample() { if (!document.hidden) reloadDevices(true); }
    sample();
    const timer = setInterval(sample, 5000);
    document.addEventListener('visibilitychange', sample);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sample); };
  }, [watchDevices]);
  useEffect(() => {
    const controller = new AbortController();
    api('state', 'GET', undefined, controller.signal).then(result => {
      setState(result);
      if (result.router.configured) reloadDevices();
    }).catch(failure => {
      if (failure.name !== 'AbortError') setStartupError(failure.message);
    });
    const poll = setInterval(() => {
      const before = revision.current;
      api('state', 'GET', undefined, controller.signal).then(next => {
        if (before === revision.current) setState(next);
      }).catch(() => {});
    }, 5000);
    return () => { clearInterval(poll); controller.abort(); pendingList.current?.abort(); };
  }, []);

  async function connect(config) {
    const data = await api('router', 'PUT', config);
    pendingList.current?.abort();
    pendingList.current = null;
    readings.current.clear();
    setFetching(false);
    applyChange(data);
    setList(data.devices);
    Toast.success(`已连接，发现 ${data.devices.length} 台在线设备`);
  }

  async function saveRule(rule) {
    applyChange(await api('rules', 'PUT', rule));
    if (!rule.id) setNewRuleKey(key => key + 1);
    setEditing(null);
    Toast.success('规则已保存');
  }

  async function acknowledge(id) {
    try { applyChange(await api('notices/ack', 'POST', { id })); }
    catch (error) { Toast.error(error.message); }
  }

  function deleteRule(rule) {
    Modal.confirm({
      title: '删除这条规则？',
      content: rule.name,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          applyChange(await api('rules', 'DELETE', { id: rule.id }));
          Toast.success('规则已删除');
        } catch (failure) {
          Toast.error(failure.message);
          throw failure;
        }
      },
    });
  }

  async function updateCalendar() {
    setUpdatingCalendar(true);
    try {
      const updated = await api('calendar', 'POST', {});
      applyChange(updated);
      const messages = updated.calendar.updates.map(calendarResult).join('；');
      if (updated.calendar.failedYears.length) Toast.warning({ content: messages, duration: 7 });
      else Toast.success(messages);
    } catch (failure) {
      Toast.error(failure.message);
    } finally {
      setUpdatingCalendar(false);
    }
  }

  if (!state) {
    return (
      <main className="startup">
        {startupError ? <Banner type="danger" description={startupError} closeIcon={null} />
          : <Spin size="large" tip="正在打开应用" />}
      </main>
    );
  }

  const { router, rules, calendar, events } = state;
  const today = calendar.workday ? '今天是工作日' : '今天是休息日';
  const desktop = !editing;
  const channels = state.channels || [];
  function openEditor(selection) {
    if (!channels.length) {
      Toast.info('请先新增通知渠道，再配置规则。');
      setTab('channels');
      return;
    }
    setEditing(selection);
  }
  const notices = events.filter(e => !e.resolvedAt && e.actions.includes('notify') && rules.some(rule => rule.id === e.ruleId));
  return (
    <div className={`shell${desktop ? ' desktop-shell' : ''}${desktop && tab === 'devices' ? ' device-shell' : ''}`}>
      {desktop && <aside className="app-sidebar">
        <nav className="app-nav" aria-label="应用导航">
          {tabs.filter(item => router.configured || ['rules', 'channels'].includes(item.id)).map(item => <button type="button" key={item.id} aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}>{item.icon}<span>{item.title}</span>
            {item.id === 'rules' && tab !== 'rules' && notices.length > 0 &&
              <span className="nav-count" aria-label={notices.length + ' 条提醒'}>{notices.length}</span>}
          </button>)}
        </nav>
        <div className="connection-actions">
          <span className="router-address" title="路由器地址"><IconWifi />{router.host}</span>
          <Button theme="borderless" type="tertiary" icon={<IconSettingStroked />} aria-label="连接设置" onClick={() => setConnectionOpen(true)}><span className="settings-label">连接设置</span></Button>
        </div>
      </aside>}
      <main className={editing ? "workspace workspace-editing" : "workspace"}>
        {tab === 'channels' && !editing ? <Channels channels={channels} rules={rules} apply={applyChange} />
          : !router.configured ? <Onboarding host={router.host} save={connect} /> : <>
          <div hidden={!!editing || tab !== 'rules'}>
            <Rules key={newRuleKey} rules={rules} notices={notices} acknowledge={acknowledge} channels={channels} create={example => openEditor({ example })}
              edit={rule => openEditor({ rule })} remove={deleteRule} />
          </div>
          {editing ? <>
            {devicesError && <Banner type="warning" description={devicesError} closeIcon={null} />}
            <RuleEditor
              channels={channels} rule={editing.rule} example={editing.example} devices={devices} refreshing={fetching}
              refresh={() => reloadDevices()} save={saveRule} cancel={() => setEditing(null)}
            />
          </> : <>
            {tab === 'devices' && <DeviceList devices={devices} fetching={fetching} loadedAt={loadedAt}
              error={devicesError} refresh={() => reloadDevices()} />}
            {tab === 'events' && <Events events={events} clear={async () => applyChange(await api('events', 'DELETE', {}))} />}
          </>}
        </>}
      </main>
      {router.configured && !editing && (
        <footer className="statusbar">
          <div className="calendar-copy">
            <strong>{today}{calendar.name && ` · ${calendar.name}`}</strong>
            <Tooltip content={calendar.updates?.map(calendarResult).join('；') || '尚未联网更新'}>
              <span className="calendar-detail" data-warning={calendar.failedYears.length > 0 || calendar.source === 'weekday_fallback'} tabIndex={0}>
                {calendar.failedYears.length ? `${calendar.failedYears.join('、')} 年日历更新失败` :
                  calendar.source === 'weekday_fallback' ? '当年日历未同步，暂按周一至周五'
                    : calendar.updatedAt ? `日历同步于 ${formatTime(calendar.updatedAt)}` : '使用内置节假日日历'}
              </span>
            </Tooltip>
          </div>
          <Button className="calendar-refresh" type="tertiary" theme="outline" loading={updatingCalendar}
            aria-busy={updatingCalendar} icon={<IconRefresh aria-hidden="true" />} onClick={updateCalendar}>
            {updatingCalendar ? '更新中…' : '更新日历'}
          </Button>
        </footer>
      )}
      <Modal centered className="connection-modal" visible={connectionOpen} title="连接设置" onCancel={() => setConnectionOpen(false)} footer={null}>
        {connectionOpen && <RouterForm host={router.host} save={connect} done={() => setConnectionOpen(false)}
          cancel={() => setConnectionOpen(false)} />}
      </Modal>
    </div>
  );
}
