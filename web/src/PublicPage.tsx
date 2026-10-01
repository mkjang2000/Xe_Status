import { ArrowDown, ArrowUpRight, Check, Clock3, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { PublicMonitor, PublicStatus, ServiceStatus } from '../../shared/types';
import { api } from './api';
import { Brand, dateTime, duration, relativeTime, StatusBadge, StatusIcon, statusLabels } from './ui';

const headlines: Record<ServiceStatus, string> = {
  operational: '모든 서비스가 정상 작동 중입니다',
  down: '일부 서비스에 문제가 있습니다',
  maintenance: '서비스 점검이 진행 중입니다',
  unknown: '서비스 상태를 확인하고 있습니다'
};
const subtitles: Record<ServiceStatus, string> = {
  operational: '서비스가 원활하게 운영되고 있습니다.',
  down: '아래에서 영향을 받는 서비스와 최근 이력을 확인하세요.',
  maintenance: '점검이 진행되는 동안 일부 서비스 이용이 제한될 수 있습니다.',
  unknown: '아직 검사 결과가 없거나 최근 상태를 확인할 수 없습니다.'
};

function ServiceRow({ monitor }: { monitor: PublicMonitor }) {
  return <article className="service-row">
    <div className="service-row-top"><div className="service-name-wrap"><h3>{monitor.name}</h3>{monitor.description && <p>{monitor.description}</p>}</div><StatusBadge status={monitor.status} /></div>
    <div className="history-bars" aria-label={`${monitor.name} 최근 30일 상태`}>
      {monitor.history.map(day => <span key={day.date} className={`history-bar history-${day.status}`} tabIndex={0} role="img" aria-label={`${day.date}: ${statusLabels[day.status]}${day.uptime === null ? ', 관측 기록 없음' : `, 가동률 ${day.uptime.toFixed(2)}%`}`}>
        <span className="history-tooltip"><strong>{day.date}</strong>{day.uptime === null ? '관측 기록 없음' : `가동률 ${day.uptime.toFixed(2)}%`}</span>
      </span>)}
    </div>
    <div className="history-labels"><span>30일 전</span><span>오늘</span></div>
  </article>;
}

export function PublicPage() {
  const [data, setData] = useState<PublicStatus | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);
  async function refresh() {
    setRefreshing(true);
    try { setData(await api<PublicStatus>('/status')); setError(false); }
    catch { setError(true); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); setTick(n => n + 1); }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data) return;
    document.title = `${data.branding.title} · 서비스 상태`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', data.branding.description);
    if (data.branding.faviconUrl) {
      let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.appendChild(favicon); }
      favicon.href = data.branding.faviconUrl;
    } else document.querySelector('link[rel="icon"]')?.remove();
  }, [data?.branding]);
  const colors = data ? {
    '--brand': data.branding.brandColor, '--page-bg': data.branding.backgroundColor,
    '--operational': data.branding.operationalColor, '--down': data.branding.downColor,
    '--maintenance': data.branding.maintenanceColor,
    '--page-text': isDark(data.branding.backgroundColor) ? '#edf2fa' : '#26334a',
    '--page-muted': isDark(data.branding.backgroundColor) ? '#a7b5c8' : '#7a8698',
    '--page-divider': isDark(data.branding.backgroundColor) ? '#ffffff20' : '#edf0f4',
    '--brand-contrast': isDark(data.branding.brandColor) ? '#ffffff' : '#26334a'
  } as CSSProperties : undefined;
  return <div className="public-page" style={colors}>
    <div className="status-shell">
      <header className="public-header"><Brand title={data?.branding.title} logoUrl={data?.branding.logoUrl} /><div className="header-right"><span className="header-status"><span className={`live-dot ${error ? 'live-offline' : `live-${data?.overall || 'unknown'}`}`} />서비스 현황</span>{data?.branding.websiteUrl && <a className="website-link" href={data.branding.websiteUrl} target="_blank" rel="noreferrer">홈페이지<ArrowUpRight size={15} /></a>}</div></header>
      <main>
        <div className="page-intro"><span className="eyebrow">SERVICE STATUS</span><h1>서비스 운영 현황</h1><p>{data?.branding.description || '서비스의 현재 상태와 최근 운영 이력을 확인하세요.'}</p></div>
        {error && <div className="refresh-warning" role="alert"><span>{data ? '상태를 새로 가져오지 못했습니다. 아래는 마지막으로 확인한 정보입니다.' : '상태 정보를 불러오지 못했습니다.'}</span><button className="text-button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} />다시 시도</button></div>}
        {!data && !error && <div className="loading-state" role="status"><RefreshCw className="spin" size={22} /><span>서비스 상태를 불러오는 중입니다.</span></div>}
        {data && <>
          <section className={`summary-banner summary-${error ? 'unknown' : data.overall}`} aria-label="전체 서비스 상태">
            <span className="summary-icon"><StatusIcon status={error ? 'unknown' : data.overall} size={24} /></span>
            <div><h2>{error ? '최신 상태를 확인할 수 없습니다' : data.monitors.length === 0 ? '서비스 등록을 기다리고 있습니다' : headlines[data.overall]}</h2><p>{error ? `마지막 정보 수신: ${dateTime(data.updatedAt)}` : data.monitors.length === 0 ? '등록된 서비스의 상태가 이곳에 표시됩니다.' : subtitles[data.overall]}</p></div>
          </section>
          <div className="summary-meta"><span><Clock3 size={13} />마지막 검사: {relativeTime(data.lastCheckAt)}</span><span className="auto-refresh"><RefreshCw size={12} className={refreshing ? 'spin' : ''} />30초마다 자동 갱신</span></div>
          <section className="services-section">
            <div className="section-heading"><div><h2>서비스 상태</h2><span className="count-chip">{data.monitors.length}</span></div><span>최근 30일 운영 이력</span></div>
            {data.monitors.length === 0 ? <div className="empty-state"><span className="empty-icon"><Server size={26} /></span><h3>아직 등록된 서비스가 없습니다</h3><p>관리자가 서비스를 등록하면 모니터링이 시작됩니다.</p></div> : <div className={`services-card ${error ? 'services-stale' : ''}`}>{data.monitors.map(monitor => <ServiceRow key={monitor.id} monitor={monitor} />)}</div>}
            <div className="history-legend"><span><i className="legend-square legend-operational" />정상</span><span><i className="legend-square legend-down" />장애</span><span><i className="legend-square legend-unknown" />미확인</span></div>
          </section>
          <section className="incidents-section">
            <div className="section-heading"><div><h2>최근 장애 이력</h2></div><span>한국 시간 · KST</span></div>
            {data.incidents.length === 0 ? <div className="no-incidents"><span className="quiet-check"><ShieldCheck size={22} /></span><div><h3>기록된 장애가 없습니다</h3><p>장애가 발생하거나 복구되면 이곳에서 확인할 수 있습니다.</p></div></div> : <div className="incident-list">{data.incidents.map(incident => <article className="incident" key={incident.id}>
              <span className={`incident-icon ${incident.resolvedAt ? 'incident-resolved' : 'incident-active'}`}>{incident.resolvedAt ? <Check size={15} /> : <ArrowDown size={15} />}</span>
              <div className="incident-content"><div className="incident-title"><h3>{incident.monitorName}</h3><span className={`incident-state ${incident.resolvedAt ? '' : 'incident-state-active'}`}>{incident.resolvedAt ? incident.resolutionCause === 'configuration' ? '설정 변경으로 종료' : '복구 완료' : '장애 진행 중'}</span></div><p>{dateTime(incident.startedAt)}{incident.resolvedAt ? ` — ${dateTime(incident.resolvedAt)}` : '부터'}</p><span className="incident-duration">{incident.resolvedAt ? `${duration(incident.startedAt, incident.resolvedAt)} 동안 발생` : `${duration(incident.startedAt, Date.now())}째 지속 중`}</span></div>
            </article>)}</div>}
          </section>
        </>}
      </main>
      <footer className="public-footer"><span><ActivityLogo />Powered by <strong>XE Status</strong></span><a href="/admin">관리자</a></footer>
    </div>
  </div>;
}

function ActivityLogo() { return <span className="footer-mark" aria-hidden="true">↗</span>; }

function isDark(hex: string): boolean {
  const color = hex.replace('#', '');
  const red = parseInt(color.slice(0, 2), 16), green = parseInt(color.slice(2, 4), 16), blue = parseInt(color.slice(4, 6), 16);
  return red * .299 + green * .587 + blue * .114 < 155;
}
