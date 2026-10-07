import { CheckHistory } from './CheckHistory';
import { IncidentHistory } from './IncidentHistory';
import { MonitorManagement } from './MonitorManagement';
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, History, LockKeyhole, LogOut, Mail, Monitor, Paintbrush, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AdminMonitor } from '../../shared/types';
import { api, ApiError, errorMessage } from './api';
import { PasswordSettings } from './PasswordSettings';
import { BrandingSettings, SmtpSettingsForm } from './SettingsForms';
import { Brand, dateTime, Notice } from './ui';

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

type AdminTab = 'incidents' | 'monitors' | 'branding' | 'smtp' | 'password';
const tabs = [{ id: 'incidents' as const, label: '장애 이력', icon: History }, { id: 'monitors' as const, label: '서비스 관리', icon: Monitor }, { id: 'branding' as const, label: '페이지 디자인', icon: Paintbrush }, { id: 'smtp' as const, label: '이메일 알림', icon: Mail }, { id: 'password' as const, label: '비밀번호', icon: LockKeyhole }];

function Dashboard({ onLogout, onPasswordChanged }: { onLogout: () => void; onPasswordChanged: () => void }) {
  const [tab, setTab] = useState<AdminTab>('monitors');
  const [monitors, setMonitors] = useState<AdminMonitor[] | null>(null);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [error, setError] = useState('');
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
  const workerActive = lastTick !== null && Date.now() - lastTick < 90000;
  return <div className="admin-page"><header className="admin-header"><div className="admin-header-inner"><div className="admin-brand-wrap"><Brand compact /><span className="admin-label">관리 콘솔</span></div><div className="admin-header-actions"><a href="/" className="button button-secondary button-small" target="_blank" rel="noreferrer">상태 페이지<ArrowUpRight size={15} /></a><button className="icon-button" title="로그아웃" aria-label="로그아웃" disabled={busy} onClick={() => void logout()}><LogOut size={18} /></button></div></div></header>
    <main className="admin-shell"><div className="admin-intro"><div><span className="eyebrow">YOUR SERVICES, AT A GLANCE</span><h1>상태 페이지 관리</h1><p>서비스를 연결하고, 운영 상태를 한눈에 살펴보세요.</p></div><div className={`worker-chip ${workerActive ? 'worker-active' : ''}`} title={`마지막 워커 활동: ${dateTime(lastTick)}`}><span className="status-dot" />{workerActive ? '검사 워커 실행 중' : '검사 워커 확인 필요'}</div></div>
      <nav className="admin-tabs" aria-label="관리 메뉴">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={17} />{item.label}{item.id === 'monitors' && <span>{monitors?.length ?? 0}</span>}</button>)}</nav>
      {error && <Notice>{error}<button className="text-button" onClick={() => void load()}>다시 시도</button></Notice>}
      {tab === 'monitors' && !monitors && !error && <p>서비스 목록을 불러오는 중입니다.</p>}
      {tab === 'monitors' && monitors && !workerActive && <Notice type="info">검사 워커의 최근 활동이 없습니다. 워커가 실행 중인지 확인해 주세요.</Notice>}
      {tab === 'monitors' && monitors && <MonitorManagement monitors={monitors} reload={load} onHistory={setHistory} />}
      {tab === 'incidents' && <IncidentHistory monitors={monitors ?? []} />}
      {tab === 'branding' && <BrandingSettings />}{tab === 'smtp' && <SmtpSettingsForm />}{tab === 'password' && <PasswordSettings onChanged={onPasswordChanged} />}
    </main><footer className="admin-footer">XE Status <span>간결하게 살피고, 빠르게 대응하세요.</span></footer>
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
