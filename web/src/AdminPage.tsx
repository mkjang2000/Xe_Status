import { ArrowLeft, ArrowUpRight, Clock3, Edit3, Eye, EyeOff, History, LockKeyhole, LogOut, Mail, Monitor, Paintbrush, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AdminMonitor, CheckRecord } from '../../shared/types';
import { api, ApiError, errorMessage } from './api';
import { PasswordSettings } from './PasswordSettings';
import { MonitorForm } from './MonitorForm';
import { BrandingSettings, SmtpSettingsForm } from './SettingsForms';
import { Brand, dateTime, Modal, Notice, relativeTime, StatusBadge } from './ui';

function Login({ onLogin, initialError, message }: { onLogin: () => void; initialError: string; message: string }) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/login', 'POST', { password }); onLogin(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <div className="login-page"><header><Brand /></header><main className="login-card"><span className="login-icon"><LockKeyhole size={25} /></span><span className="eyebrow">ADMIN CONSOLE</span><h1>다시 만나 반갑습니다.</h1><p>서비스 상태를 관리하려면 로그인하세요.</p><form onSubmit={submit}>{message && <Notice type="success">{message}</Notice>}{error && <Notice>{error}</Notice>}<label className="field"><span className="field-label">관리자 비밀번호</span><span className="password-input"><input autoFocus required type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호를 입력하세요" /><button type="button" className="icon-button" aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label><button className="button button-primary login-submit" disabled={busy}>{busy ? '로그인 중…' : '관리자 로그인'}</button></form><a className="back-link" href="/"><ArrowLeft size={15} />공개 상태 페이지로 돌아가기</a></main><p className="login-footer">XE Status · 서비스의 안정을 살피는 작은 공간</p></div>;
}

function CheckHistory({ monitor, onClose }: { monitor: AdminMonitor; onClose: () => void }) {
  const [checks, setChecks] = useState<CheckRecord[] | null>(null);
  const [error, setError] = useState('');
  async function load() { try { setChecks(await api<CheckRecord[]>(`/admin/monitors/${monitor.id}/checks`)); setError(''); } catch (cause) { setError(errorMessage(cause)); } }
  useEffect(() => { void load(); }, [monitor.id]);
  return <Modal title={`${monitor.name} · 검사 기록`} description="최근 검사 결과와 실패 이유는 관리자에게만 표시됩니다." onClose={onClose}><div className="modal-body">{error && <Notice>{error}<button type="button" className="text-button" onClick={() => void load()}>다시 시도</button></Notice>}{!checks && !error && <p className="loading-inline">기록을 불러오는 중입니다.</p>}{checks?.length === 0 && <div className="empty-state"><Clock3 size={24} /><h3>아직 검사 기록이 없습니다</h3><p>워커가 실행 중이면 곧 첫 검사가 시작됩니다.</p></div>}{checks && checks.length > 0 && <div className="check-list">{checks.map(check => <div className="check-row" key={check.id}><span className={`check-outcome check-${check.outcome}`}>{check.outcome === 'up' ? '성공' : check.outcome === 'down' ? '실패' : '미확인'}</span><div><strong>{dateTime(check.checkedAt)}</strong><p>{check.message || '정상 응답'}</p></div><span className="latency">{check.latencyMs === null ? '—' : `${Math.round(check.latencyMs)} ms`}</span></div>)}</div>}</div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>닫기</button></div></Modal>;
}

type AdminTab = 'monitors' | 'branding' | 'smtp' | 'password';
const tabs = [{ id: 'monitors' as const, label: '서비스 관리', icon: Monitor }, { id: 'branding' as const, label: '페이지 디자인', icon: Paintbrush }, { id: 'smtp' as const, label: '이메일 알림', icon: Mail }, { id: 'password' as const, label: '비밀번호', icon: LockKeyhole }];

function Dashboard({ onLogout, onPasswordChanged }: { onLogout: () => void; onPasswordChanged: () => void }) {
  const [tab, setTab] = useState<AdminTab>('monitors');
  const [monitors, setMonitors] = useState<AdminMonitor[] | null>(null);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<AdminMonitor | null | undefined>(undefined);
  const [history, setHistory] = useState<AdminMonitor | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [items, health] = await Promise.all([api<AdminMonitor[]>('/admin/monitors'), api<{ lastTick: number | null }>('/admin/health')]);
      setMonitors(items); setLastTick(health.lastTick); setError('');
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) onLogout(); else setError(errorMessage(cause)); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, []);
  async function logout() {
    setBusy(true);
    try { await api('/auth/logout', 'POST'); onLogout(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function remove(monitor: AdminMonitor) {
    if (!window.confirm(`“${monitor.name}” 서비스를 삭제할까요? 검사와 장애 이력도 함께 삭제됩니다.`)) return;
    setBusy(true); setNotice('');
    try { await api(`/admin/monitors/${monitor.id}`, 'DELETE'); setNotice('서비스를 삭제했습니다.'); await load(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  const workerActive = lastTick !== null && Date.now() - lastTick < 90000;
  const activeCount = monitors?.filter(m => m.enabled).length ?? 0;
  return <div className="admin-page"><header className="admin-header"><div className="admin-header-inner"><div className="admin-brand-wrap"><Brand compact /><span className="admin-label">관리 콘솔</span></div><div className="admin-header-actions"><a href="/" className="button button-secondary button-small" target="_blank" rel="noreferrer">상태 페이지<ArrowUpRight size={15} /></a><button className="icon-button" title="로그아웃" aria-label="로그아웃" disabled={busy} onClick={() => void logout()}><LogOut size={18} /></button></div></div></header>
    <main className="admin-shell"><div className="admin-intro"><div><span className="eyebrow">YOUR SERVICES, AT A GLANCE</span><h1>상태 페이지 관리</h1><p>서비스를 연결하고, 운영 상태를 한눈에 살펴보세요.</p></div><div className={`worker-chip ${workerActive ? 'worker-active' : ''}`} title={`마지막 워커 활동: ${dateTime(lastTick)}`}><span className="status-dot" />{workerActive ? '검사 워커 실행 중' : '검사 워커 확인 필요'}</div></div>
      <nav className="admin-tabs" aria-label="관리 메뉴">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setNotice(''); }}><item.icon size={17} />{item.label}{item.id === 'monitors' && <span>{monitors?.length ?? 0}</span>}</button>)}</nav>
      {error && <Notice>{error}<button className="text-button" onClick={() => void load()}>다시 시도</button></Notice>}
      {notice && <Notice type="success">{notice}</Notice>}
      {tab === 'monitors' && <section className="admin-monitor-section"><div className="admin-section-heading"><div><h2>모니터링 서비스</h2><p>{monitors ? `${monitors.length}개 서비스 중 ${activeCount}개를 감시하고 있습니다.` : '서비스 목록을 불러오고 있습니다.'}</p></div><button className="button button-primary" onClick={() => setEditing(null)}><Plus size={17} />서비스 추가</button></div>
        {monitors && !workerActive && <Notice type="info">검사 워커의 최근 활동이 없습니다. 워커가 실행 중인지 확인해 주세요.</Notice>}
        {!monitors && !error && <div className="loading-state"><RefreshCw className="spin" size={22} /><span>서비스를 불러오는 중입니다.</span></div>}
        {monitors?.length === 0 && <div className="empty-state admin-empty"><span className="empty-icon"><Server size={29} /></span><h3>첫 번째 서비스를 연결해 보세요</h3><p>웹사이트, API 또는 서버 주소를 등록하면<br />상태를 주기적으로 확인해 드립니다.</p><button className="button button-secondary" onClick={() => setEditing(null)}><Plus size={16} />서비스 등록하기</button><div className="supported-kinds"><span>HTTP / HTTPS</span><span>JSON API</span><span>Ping</span></div></div>}
        {monitors && monitors.length > 0 && <div className="admin-monitor-list">{monitors.map(monitor => <article className="admin-monitor" key={monitor.id}><div className={`monitor-type-icon ${monitor.enabled ? '' : 'monitor-paused'}`}><Server size={20} /></div><div className="admin-monitor-info"><div className="admin-monitor-name"><h3>{monitor.name}</h3><span className="type-label">{monitor.kind === 'http' ? 'HTTP' : monitor.kind === 'json' ? 'JSON API' : 'PING'}</span>{!monitor.enabled && <span className="paused-label">일시 정지</span>}</div><p className="monitor-target">{monitor.target}</p><div className="monitor-meta"><span>{monitor.intervalSeconds}초 간격</span><span>최근 검사: {relativeTime(monitor.lastCheckAt)}</span>{monitor.lastResult?.latencyMs != null && <span>{Math.round(monitor.lastResult.latencyMs)} ms</span>}</div></div><div className="admin-monitor-status"><StatusBadge status={monitor.displayStatus} /></div><div className="monitor-actions"><button className="icon-button" title="검사 기록" aria-label={`${monitor.name} 검사 기록`} onClick={() => setHistory(monitor)}><History size={17} /></button><button className="icon-button" title="수정" aria-label={`${monitor.name} 수정`} onClick={() => setEditing(monitor)}><Edit3 size={17} /></button><button className="icon-button danger-hover" title="삭제" aria-label={`${monitor.name} 삭제`} disabled={busy} onClick={() => void remove(monitor)}><Trash2 size={17} /></button></div></article>)}</div>}
        <div className="admin-footnote"><LockKeyhole size={13} /><span>검사 주소와 인증 정보는 공개 상태 페이지에 표시되지 않습니다.</span></div>
      </section>}
      {tab === 'branding' && <BrandingSettings />}{tab === 'smtp' && <SmtpSettingsForm />}{tab === 'password' && <PasswordSettings onChanged={onPasswordChanged} />}
    </main><footer className="admin-footer">XE Status <span>간결하게 살피고, 빠르게 대응하세요.</span></footer>
    {editing !== undefined && <Modal title={editing ? '서비스 수정' : '새 서비스 추가'} description="검사 조건을 설정하면 워커가 주기적으로 상태를 확인합니다." onClose={() => setEditing(undefined)}><MonitorForm monitor={editing} onSaved={() => { setEditing(undefined); setNotice(editing ? '서비스 설정을 저장했습니다.' : '서비스를 추가했습니다. 첫 검사 결과가 곧 표시됩니다.'); void load(); }} onCancel={() => setEditing(undefined)} /></Modal>}
    {history && <CheckHistory monitor={history} onClose={() => setHistory(null)} />}
  </div>;
}

export function AdminPage() {
  const [message, setMessage] = useState('');
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    document.title = '관리 콘솔 · XE Status';
    void api<{ authenticated: boolean }>('/auth/session').then(session => setAuthenticated(session.authenticated)).catch(cause => { setError(errorMessage(cause)); setAuthenticated(false); });
  }, []);
  if (authenticated === null) return <div className="app-loading" role="status"><RefreshCw className="spin" size={24} /><p>관리 콘솔을 불러오는 중입니다.</p></div>;
  return authenticated ? <Dashboard onLogout={() => setAuthenticated(false)} onPasswordChanged={() => { setMessage('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.'); setError(''); setAuthenticated(false); }} /> : <Login initialError={error} message={message} onLogin={() => { setMessage(''); setAuthenticated(true); }} />;
}
