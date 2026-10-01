import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from './api';
import { Field, Notice } from './ui';

export function PasswordSettings({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (newPassword !== confirmPassword) { setError('새 비밀번호와 확인 값이 일치하지 않습니다.'); return; }
    if (newPassword === currentPassword) { setError('기존과 다른 새 비밀번호를 입력하세요.'); return; }
    setBusy(true);
    try {
      await api('/admin/password', 'POST', { currentPassword, newPassword, confirmPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      onChanged();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="settings-card">
    <div className="settings-card-heading"><span className="settings-icon"><LockKeyhole size={21} /></span><div><h2>관리자 비밀번호</h2><p>기억하기 쉬운 긴 문장으로 비밀번호를 설정해도 좋습니다.</p></div></div>
    {error && <Notice>{error}</Notice>}
    <form onSubmit={save}>
      <div className="form-section"><div className="form-grid">
        <Field label="현재 비밀번호" wide><input type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></Field>
        <Field label="새 비밀번호" hint="12자 이상 입력하세요. 공백도 사용할 수 있습니다." wide><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field>
        <Field label="새 비밀번호 확인" wide><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Field>
      </div></div>
      <div className="settings-footer"><span>변경하면 모든 기기에서 로그아웃됩니다. 새 비밀번호로 다시 로그인해 주세요.</span><button className="button button-primary" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button></div>
    </form>
  </section>;
}
