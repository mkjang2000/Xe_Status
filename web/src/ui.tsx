import { Activity, AlertCircle, Check, CircleHelp, Wrench, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { ServiceStatus } from '../../shared/types';

export const statusLabels: Record<ServiceStatus, string> = {
  operational: '정상 운영', down: '장애 발생', maintenance: '점검 중', unknown: '미확인'
};
export function StatusIcon({ status, size = 17 }: { status: ServiceStatus; size?: number }) {
  const Icon = status === 'operational' ? Check : status === 'down' ? AlertCircle : status === 'maintenance' ? Wrench : CircleHelp;
  return <Icon size={size} aria-hidden="true" />;
}
export function StatusBadge({ status }: { status: ServiceStatus }) {
  return <span className={`status-badge status-${status}`}><span className="status-dot" />{statusLabels[status]}</span>;
}
export function Brand({ title = 'XE Status', logoUrl = '', compact = false }: { title?: string; logoUrl?: string; compact?: boolean }) {
  return <a className={`brand ${compact ? 'brand-compact' : ''}`} href="/" aria-label={`${title} 상태 페이지`}>
    {logoUrl ? <img src={logoUrl} alt="" className="brand-logo" /> : <span className="brand-symbol"><Activity size={23} strokeWidth={2} /></span>}
    <span>{title}</span>
  </a>;
}
export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? 'field-wide' : ''}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
export function Toggle({ checked, onChange, title, description }: { checked: boolean; onChange: (v: boolean) => void; title: string; description?: string }) {
  return <label className="toggle-row"><span><strong>{title}</strong>{description && <small>{description}</small>}</span><input className="toggle-input" type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="toggle-switch" aria-hidden="true" /></label>;
}
export function Notice({ children, type = 'error' }: { children: ReactNode; type?: 'error' | 'success' | 'info' }) {
  return <div className={`notice notice-${type}`} role={type === 'error' ? 'alert' : 'status'}><AlertCircle size={17} /><span>{children}</span></div>;
}
export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; element?.close(); };
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="dialog-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-header"><div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={21} /></button></div>
    {children}
  </dialog>;
}
export function dateTime(value: number | null): string {
  return value === null ? '아직 기록 없음' : new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(value);
}
export function relativeTime(value: number | null): string {
  if (value === null) return '아직 검사하지 않음';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}
export function duration(start: number, end: number): string {
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}
