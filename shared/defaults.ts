import type { Branding, MonitorInput, SmtpSettings } from './types.js';
export const defaultBranding: Branding = {
  title: 'XE Status', description: '서비스의 현재 상태와 최근 운영 이력을 확인하세요.',
  logoUrl: '', faviconUrl: '', websiteUrl: '', brandColor: '#2563eb', backgroundColor: '#ffffff',
  operationalColor: '#16a374', downColor: '#e05260', maintenanceColor: '#537de5'
};
export const defaultMonitor: MonitorInput = {
  name: '', description: '', kind: 'http', target: '', intervalSeconds: 60, timeoutSeconds: 10,
  failureThreshold: 3, recoveryThreshold: 2, enabled: true, maintenance: false, maintenanceUntil: null,
  method: 'GET', headers: {}, body: '', expectedStatus: 200, rules: [], sortOrder: 0
};
export const defaultSmtp: SmtpSettings = {
  enabled: false, host: '', port: 587, security: 'starttls', username: '', password: '', from: '', recipients: []
};
