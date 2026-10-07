import { useState } from 'react';
import type { AdminMonitor } from '../../shared/types';
import { api, errorMessage } from './api';
import { Modal, Notice, relativeTime, StatusBadge } from './ui';
import { MonitorForm } from './MonitorForm';

export function MonitorManagement({ monitors, reload, onHistory }: { monitors: AdminMonitor[]; reload: () => Promise<void>; onHistory: (m: AdminMonitor) => void }) {
  const [search, setSearch] = useState(''); const [group, setGroup] = useState('*'); const [state, setState] = useState('active');
  const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [editing, setEditing] = useState<AdminMonitor | null | undefined>(); const [duplicate, setDuplicate] = useState(false);
  const visible = monitors.filter(m => (group === '*' || (m.group ?? '') === group) && `${m.name} ${m.target}`.toLowerCase().includes(search.toLowerCase()) &&
    (state === 'archived' ? m.archived : !m.archived && (state === 'active' || state === 'paused' ? state === 'active' || !m.enabled : m.enabled && m.displayStatus === state)));
  function resetSelection() { setSelected([]); }
  async function move(id: string, direction: 'up' | 'down') {
    setBusy(true); setError('');
    try { await api(`/admin/monitors/${id}/move`, 'POST', { direction }); await reload(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function bulk(action: string, ids = selected) {
    if (!ids.length) return;
    const extra: { group?: string; until?: number | null } = {};
    if (action === 'group') { const value = window.prompt('이동할 그룹 이름 (빈 값은 미분류)'); if (value === null) return; extra.group = value; }
    if (action === 'maintenance') {
      const value = window.prompt('점검 종료 시각을 입력하세요 (예: 2026-10-05T18:00). 빈 값은 직접 종료할 때까지 유지합니다.');
      if (value === null) return; extra.until = value.trim() ? new Date(value).getTime() : null;
      if (extra.until !== null && (!Number.isFinite(extra.until) || extra.until <= Date.now())) { setError('미래의 유효한 종료 시각을 입력하세요.'); return; }
    }
    if (action === 'archive' && !window.confirm(`${ids.length}개 서비스를 보관할까요? 감시와 공개 표시를 중단하고 이력은 보존합니다.`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api('/admin/monitors/bulk', 'POST', { ids, action, ...extra }); setSelected([]); await reload(); setNotice(action === 'restore' ? '복원했습니다. 확인 후 감시를 재개하세요.' : '변경 사항을 저장했습니다.'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="admin-monitor-section"><div className="admin-section-heading"><div><h2>모니터링 서비스</h2><p>{visible.length}개 표시 · 전체 {monitors.length}개</p></div><button className="button button-primary" onClick={() => { setDuplicate(false); setEditing(null); }}>서비스 추가</button></div>
    {error && <Notice>{error}</Notice>}{notice && <Notice type="success">{notice}</Notice>}
    <div className="management-toolbar"><input aria-label="모니터 검색" placeholder="이름 또는 주소 검색" value={search} onChange={e => { setSearch(e.target.value); resetSelection(); }} />
      <select aria-label="그룹 필터" value={group} onChange={e => { setGroup(e.target.value); resetSelection(); }}><option value="*">모든 그룹</option><option value="">미분류</option>{[...new Set(monitors.map(m => m.group).filter(Boolean))].sort().map(g => <option key={g} value={g}>{g}</option>)}</select>
      <select aria-label="모니터 상태 필터" value={state} onChange={e => { setState(e.target.value); resetSelection(); }}><option value="active">보관 제외 전체</option><option value="operational">정상</option><option value="down">장애</option><option value="unknown">미확인</option><option value="maintenance">점검</option><option value="paused">일시 정지</option><option value="archived">보관됨</option></select>
    </div>
    <div className="management-toolbar"><label><input type="checkbox" aria-label="표시된 모니터 전체 선택" checked={visible.length > 0 && visible.every(m => selected.includes(m.id))} onChange={e => setSelected(e.target.checked ? visible.map(m => m.id) : [])} /> 전체 선택</label><span>{selected.length}개 선택</span>
      <button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('group')}>그룹 이동</button>
      {state === 'archived' ? <button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('restore')}>선택 복원</button> : <>
        <button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('enable')}>선택 재개</button><button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('disable')}>선택 중지</button>
        <button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('maintenance')}>점검 설정</button><button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('maintenance-end')}>점검 종료</button><button className="button button-secondary" disabled={busy || !selected.length} onClick={() => void bulk('archive')}>선택 보관</button>
      </>}
    </div>
    {!visible.length && <div className="empty-state"><h3>{monitors.length ? '조건에 맞는 서비스가 없습니다' : '첫 번째 서비스를 연결해 보세요'}</h3></div>}
    <div className="admin-monitor-list">{visible.map(m => <article className="admin-monitor managed-monitor" key={m.id}>
      <input type="checkbox" aria-label={`${m.name} 선택`} checked={selected.includes(m.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} />
      <div className="admin-monitor-info"><div className="admin-monitor-name"><h3>{m.name}</h3><span className="type-label">{m.kind === 'json' ? 'JSON API' : m.kind.toUpperCase()}</span>{!m.enabled && <span className="paused-label">{m.archived ? '보관됨' : '일시 정지'}</span>}</div><p className="monitor-target">{m.target}</p><div className="monitor-meta"><span>{m.group || '미분류'}</span><span>순서 {m.sortOrder}</span><span>{m.intervalSeconds}초 간격</span><span>최근 검사: {relativeTime(m.lastCheckAt)}</span></div></div>
      <StatusBadge status={m.displayStatus} /><div className="monitor-actions"><button className="text-button" aria-label={`${m.name} 위로`} disabled={busy || group !== '*' || !!search || !['active', 'archived'].includes(state)} onClick={() => void move(m.id, 'up')}>↑</button><button className="text-button" aria-label={`${m.name} 아래로`} disabled={busy || group !== '*' || !!search || !['active', 'archived'].includes(state)} onClick={() => void move(m.id, 'down')}>↓</button><button className="text-button" aria-label={`${m.name} 검사 기록`} onClick={() => onHistory(m)}>검사 기록</button><button className="text-button" aria-label={`${m.name} 수정`} onClick={() => { setDuplicate(false); setEditing(m); }}>수정</button><button className="text-button" aria-label={`${m.name} 복제`} onClick={() => { setDuplicate(true); setEditing({ ...m, name: `${m.name.slice(0, 95)} 복사`, enabled: false, archived: false }); }}>복제</button>
        <button className="text-button" disabled={busy} onClick={() => void bulk(m.archived ? 'restore' : m.enabled ? 'disable' : 'enable', [m.id])}>{m.archived ? '복원' : m.enabled ? '중지' : '재개'}</button>{!m.archived && <button className="text-button" disabled={busy} onClick={() => void bulk('archive', [m.id])}>보관</button>}</div>
    </article>)}</div>
    {editing !== undefined && <Modal title={duplicate ? '서비스 복제' : editing ? '서비스 수정' : '새 서비스 추가'} description={duplicate ? '복제본은 일시 정지 상태로 생성됩니다. 주소와 인증 정보를 확인하세요.' : '표시 순서와 그룹, 검사 조건을 변경할 수 있습니다.'} onClose={() => setEditing(undefined)}><MonitorForm monitor={editing} duplicate={duplicate} onSaved={() => { setEditing(undefined); setNotice('서비스 설정을 저장했습니다.'); void reload(); }} onCancel={() => setEditing(undefined)} /></Modal>}
  </section>;
}
