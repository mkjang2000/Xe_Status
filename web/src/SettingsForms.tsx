import { Check, Mail, Paintbrush, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import type { Branding, DeliveryRecord, SmtpView } from '../../shared/types';
import { api, errorMessage } from './api';
import { Brand, dateTime, Field, Notice, Toggle } from './ui';

const colorFields: { key: keyof Branding; label: string }[] = [
  { key: 'brandColor', label: '브랜드 색상' }, { key: 'backgroundColor', label: '페이지 배경' },
  { key: 'operationalColor', label: '정상 상태' }, { key: 'downColor', label: '장애 상태' }, { key: 'maintenanceColor', label: '점검 상태' }
];

export function BrandingSettings() {
  const [form, setForm] = useState<Branding | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function load() { try { setForm(await api<Branding>('/admin/branding')); setError(''); } catch (cause) { setError(errorMessage(cause)); } }
  useEffect(() => { void load(); }, []);
  function update(key: keyof Branding, value: string) { setForm(current => current ? { ...current, [key]: value } : null); setSaved(false); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try { setForm(await api<Branding>('/admin/branding', 'PUT', form)); setSaved(true); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <section className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><Paintbrush size={21} /></span><div><h2>페이지 디자인</h2><p>서비스의 분위기에 맞게 공개 페이지를 꾸며보세요.</p></div></div>
    {error && <Notice>{error} {!form && <button className="text-button" onClick={() => void load()}>다시 시도</button>}</Notice>}
    {saved && <Notice type="success">디자인 설정이 저장되었습니다. 공개 페이지에 바로 반영됩니다.</Notice>}
    {!form && !error && <p className="loading-inline">설정을 불러오는 중입니다.</p>}
    {form && <form onSubmit={save}>
      <div className="form-section"><h3>페이지 정보</h3><div className="form-grid">
        <Field label="페이지 이름" wide><input required maxLength={80} value={form.title} onChange={e => update('title', e.target.value)} placeholder="XE Status" /></Field>
        <Field label="소개 문구" wide><textarea rows={2} maxLength={300} value={form.description} onChange={e => update('description', e.target.value)} /></Field>
        <Field label="홈페이지 URL (선택)" wide><input type="url" value={form.websiteUrl} onChange={e => update('websiteUrl', e.target.value)} placeholder="https://example.com" /></Field>
        <Field label="로고 이미지 URL (선택)"><input type="url" value={form.logoUrl} onChange={e => update('logoUrl', e.target.value)} placeholder="https://example.com/logo.png" /></Field>
        <Field label="파비콘 URL (선택)"><input type="url" value={form.faviconUrl} onChange={e => update('faviconUrl', e.target.value)} placeholder="https://example.com/favicon.ico" /></Field>
      </div></div>
      <div className="form-section"><h3>색상</h3><div className="color-fields">{colorFields.map(field => <Field key={field.key} label={field.label}><div className="color-input"><input type="color" aria-label={`${field.label} 선택`} value={/^#[0-9a-f]{6}$/i.test(form[field.key]) ? form[field.key] : '#ffffff'} onChange={e => update(field.key, e.target.value)} /><input aria-label={`${field.label} 색상 코드`} pattern="#[0-9a-fA-F]{6}" required value={form[field.key]} onChange={e => update(field.key, e.target.value)} maxLength={7} /></div></Field>)}</div>
        <div className="branding-preview" style={{ background: form.backgroundColor, '--brand': form.brandColor } as CSSProperties}><Brand title={form.title} logoUrl={form.logoUrl} compact /><div className="preview-states"><span><i style={{ background: form.operationalColor }} />정상</span><span><i style={{ background: form.downColor }} />장애</span><span><i style={{ background: form.maintenanceColor }} />점검</span></div><span className="preview-caption">색상 미리보기</span></div>
      </div>
      <div className="settings-footer"><span>로고와 파비콘은 공개 이미지 주소를 사용합니다.</span><button className="button button-primary" disabled={busy}><Check size={16} />{busy ? '저장 중…' : '디자인 저장'}</button></div>
    </form>}
  </section>;
}

export function SmtpSettingsForm() {
  const [form, setForm] = useState<SmtpView | null>(null);
  const [recipients, setRecipients] = useState('');
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  async function load() {
    try {
      const [settings, history] = await Promise.all([api<SmtpView>('/admin/smtp'), api<DeliveryRecord[]>('/admin/deliveries')]);
      setForm({ ...settings, password: '' }); setRecipients(settings.recipients.join('\n')); setDeliveries(history); setError('');
    } catch (cause) { setError(errorMessage(cause)); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void api<DeliveryRecord[]>('/admin/deliveries').then(setDeliveries).catch(() => undefined); }, 10000);
    return () => window.clearInterval(timer);
  }, []);
  function update<K extends keyof SmtpView>(key: K, value: SmtpView[K]) { setForm(current => current ? { ...current, [key]: value } : null); setDirty(true); setMessage(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { passwordSet: _passwordSet, ...payload } = form;
      const settings = await api<SmtpView>('/admin/smtp', 'PUT', { ...payload, recipients: recipients.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) });
      setForm({ ...settings, password: '' }); setRecipients(settings.recipients.join('\n')); setDirty(false); setMessage('메일 알림 설정을 저장했습니다.');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function test() {
    setTesting(true); setError(''); setMessage('');
    try { await api('/admin/smtp/test', 'POST'); setMessage('테스트 메일 발송을 요청했습니다. 아래 발송 기록에서 결과를 확인하세요.'); setDeliveries(await api<DeliveryRecord[]>('/admin/deliveries')); }
    catch (cause) { setError(errorMessage(cause)); } finally { setTesting(false); }
  }
  return <div className="settings-stack"><section className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><Mail size={21} /></span><div><h2>이메일 알림</h2><p>서비스에 장애가 발생하거나 복구되면 메일로 알려드립니다.</p></div></div>
    {error && <Notice>{error} {!form && <button className="text-button" onClick={() => void load()}>다시 시도</button>}</Notice>}
    {message && <Notice type="success">{message}</Notice>}
    {!form && !error && <p className="loading-inline">설정을 불러오는 중입니다.</p>}
    {form && <form onSubmit={save}>
      <Toggle checked={form.enabled} onChange={value => update('enabled', value)} title="메일 알림 사용" description="장애와 복구 시 각각 한 번 발송합니다. 점검 중 알림은 억제합니다." />
      <div className="form-section"><h3>SMTP 연결</h3><div className="form-grid">
        <Field label="SMTP 호스트"><input value={form.host} required={form.enabled} onChange={e => update('host', e.target.value)} placeholder="smtp.example.com" autoComplete="off" /></Field>
        <Field label="포트"><input type="number" required min={1} max={65535} value={form.port} onChange={e => update('port', Number(e.target.value))} /></Field>
        <Field label="암호화 방식"><select value={form.security} onChange={e => update('security', e.target.value as SmtpView['security'])}><option value="starttls">STARTTLS (일반적으로 587)</option><option value="tls">TLS (일반적으로 465)</option></select></Field>
        <Field label="사용자 이름 (선택)"><input value={form.username} onChange={e => update('username', e.target.value)} autoComplete="off" /></Field>
        <Field label="비밀번호" hint={form.passwordSet ? '비워두면 저장된 비밀번호를 유지합니다.' : 'SMTP 서버에서 발급한 비밀번호 또는 앱 비밀번호를 입력하세요.'} wide><input type="password" value={form.password || ''} onChange={e => update('password', e.target.value)} autoComplete="new-password" placeholder={form.passwordSet ? '저장된 비밀번호 있음' : ''} /></Field>
      </div></div>
      <div className="form-section"><h3>발신자와 수신자</h3><div className="form-grid"><Field label="발신 이메일" wide><input type="email" required={form.enabled} value={form.from} onChange={e => update('from', e.target.value)} placeholder="status@example.com" /></Field><Field label="수신 이메일" hint="한 줄에 하나씩 입력하세요. 최대 20명까지 등록할 수 있습니다." wide><textarea required={form.enabled} rows={3} value={recipients} onChange={e => { setRecipients(e.target.value); setDirty(true); setMessage(''); }} placeholder="admin@example.com" /></Field></div></div>
      <div className="settings-footer"><button type="button" className="button button-secondary" disabled={testing || busy || dirty || !form.enabled} title={dirty ? '변경 사항을 먼저 저장해 주세요.' : undefined} onClick={() => void test()}><Send size={15} />{testing ? '요청 중…' : '테스트 메일'}</button><button className="button button-primary" disabled={busy}>{busy ? '저장 중…' : '알림 설정 저장'}</button></div>
      {dirty && <p className="field-hint save-first-hint">변경 사항을 저장한 후 테스트 메일을 보낼 수 있습니다.</p>}
    </form>}
  </section><section className="settings-card"><div className="section-heading"><div><h2>최근 발송 기록</h2></div><span>10초마다 갱신</span></div>{deliveries.length === 0 ? <p className="empty-inline">아직 메일 발송 기록이 없습니다.</p> : <div className="delivery-list">{deliveries.map(item => <div className="delivery-row" key={item.id}><div><strong>{item.kind === 'test' ? '테스트 메일' : item.kind === 'recovery' || item.kind === 'up' ? '복구 알림' : item.kind === 'down' || item.kind === 'incident' ? '장애 알림' : item.kind}</strong><span>{dateTime(item.createdAt)} · {item.attempts}회 시도</span>{item.lastError && <p>{item.lastError}</p>}</div><span className={`delivery-state delivery-${item.status}`}>{({ sent: '발송 완료', pending: '발송 대기', failed: '발송 실패', sending: '발송 중', cancelled: '발송 취소' } as Record<string, string>)[item.status] || item.status}</span></div>)}</div>}</section></div>;
}
