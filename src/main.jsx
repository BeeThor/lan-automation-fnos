import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@douyinfe/semi-ui';
import zhCN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('app')).render(
  <LocaleProvider locale={zhCN}><App /></LocaleProvider>,
);
