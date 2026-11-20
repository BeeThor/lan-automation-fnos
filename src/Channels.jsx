import React, { useState } from 'react';
import { Banner, Button, Input, Modal, Pagination, Select, Toast } from '@douyinfe/semi-ui';
import { IconBellStroked, IconPlus } from '@douyinfe/semi-icons';
import { api } from './shared';
import { useFittedPage } from './useFittedPage';

const types = { serverchan: 'Server 酱 Turbo', pushdeer: 'PushDeer' };
const blank = { type: 'serverchan', name: '', key: '', endpoint: '', limit: 5 };

export function Channels({ channels, rules, apply }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const list = useFittedPage(channels.length);
  const set = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  function edit(channel) {
    setError('');
    setDraft({ ...blank, ...channel, key: '' });
  }
  async function save() {
    setBusy('save'); setError('');
    try {
      apply(await api('channels', 'PUT', { ...draft, name: draft.name.trim() || types[draft.type] }));
      if (!draft.id) list.select(channels.length);
      setDraft(null);
      Toast.success('通知渠道已保存');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function test(id) {
    setBusy(id);
    try { apply(await api('channels/test', 'POST', { id })); Toast.success('推送服务已受理测试消息'); }
    catch (failure) { Toast.error(failure.message); }
    finally { setBusy(''); }
  }
  function remove(channel) {
    Modal.confirm({ title: '删除通知渠道？', content: channel.name, okText: '删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try { apply(await api('channels', 'DELETE', { id: channel.id })); }
        catch (failure) { Toast.error(failure.message); throw failure; }
      },
    });
  }
  return <section className="panel">
    <div className="panel-heading"><h2>通知渠道</h2><Button theme="solid" icon={<IconPlus />} onClick={() => edit(blank)}>新增渠道</Button></div>
    {channels.length ? <ul className="channel-list" ref={list.listRef}>{list.slice(channels).map(channel => {
      const referenced = rules.some(r => r.channelIds?.includes(channel.id));
      return <li key={channel.id}><IconBellStroked aria-hidden="true" /><div className="channel-copy">
        <strong>{channel.name}</strong><small>{types[channel.type]}{channel.type === 'serverchan'
          ? ` · 今日预计剩余 ${channel.remaining} / ${channel.limit} 次` : ' · ' + channel.endpoint}</small>
      </div><div className="channel-tools">
        <Button size="small" disabled={!!busy} loading={busy === channel.id} onClick={() => test(channel.id)}>测试</Button>
        <Button size="small" disabled={!!busy} onClick={() => edit(channel)}>编辑</Button>
        <Button size="small" type="danger" theme="borderless" disabled={referenced || !!busy}
          title={referenced ? '请先修改引用此渠道的规则' : undefined} onClick={() => remove(channel)}>删除</Button>
      </div></li>;
    })}</ul> : <p className="table-empty">先添加一个通知渠道，即可在规则中选择手机提醒的接收方式。</p>}
    <Pagination className="rule-pager" {...list.pager} />
    <Modal centered className="channel-modal" visible={!!draft} title={draft?.id ? '编辑通知渠道' : '新增通知渠道'} okText="保存" cancelText="取消"
      confirmLoading={busy === 'save'} onOk={save} onCancel={() => { if (!busy) setDraft(null); }}>
      {draft && <div className="channel-fields">
        <label>渠道类型<Select aria-label="渠道类型" value={draft.type} disabled={!!draft.id} onChange={type => setDraft({ ...blank, type })}
          optionList={Object.entries(types).map(([value,label]) => ({value,label}))} /></label>
        <label>渠道名称<Input value={draft.name} maxLength={40} placeholder={types[draft.type]} onChange={v => set('name', v)} /></label>
        {draft.type === 'pushdeer' && <label>服务地址<Input value={draft.endpoint} placeholder="http://192.168.1.10:8800" onChange={v => set('endpoint', v)} /></label>}
        <label>{draft.type === 'pushdeer' ? 'PushKey' : 'SendKey'}<Input mode="password" type="password" autoComplete="new-password" value={draft.key}
          placeholder={draft.id ? '已保存，留空沿用原密钥' : '输入推送密钥'} onChange={v => set('key', v)} /></label>
        {draft.type === 'serverchan' && <label>每日额度<Select aria-label="每日额度" value={draft.limit} onChange={v => set('limit', v)}
          optionList={[{value:5,label:'免费版 · 5 次'},{value:1000,label:'会员版 · 1000 次'}]} />
          <small>按北京时间统计本应用对此 SendKey 的请求，其他应用的用量以官网为准。</small></label>}
        {error && <Banner type="danger" description={error} closeIcon={null} />}
      </div>}
    </Modal>
  </section>;
}
