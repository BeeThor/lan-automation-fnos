import React from 'react';
import Icon from '@douyinfe/semi-icons';

export function DeviceIcon(props) {
  return <Icon {...props} svg={<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M11 19H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2" />
    <rect x="13" y="9" width="9" height="13" rx="2" />
    <path d="M16.5 19h2" />
  </svg>} />;
}
