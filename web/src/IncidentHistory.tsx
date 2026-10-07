import { useEffect, useState } from 'react';
import type { AdminIncident, AdminMonitor, IncidentDetail, Page } from '../../shared/types';
import { api, errorMessage } from './api';
import { dateTime, Modal, Notice } from './ui';

export function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  return <div className="history-pager"><button className="button button-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전</button><span>{page} / {Math.max(1, Math.ceil(total / pageSize))} · {total}건</span><button className="button button-secondary" disabled={page * pageSize >= total} onClick={() => onChange(page + 1)}>다음</button></div>;
}
const localTime = (n: number) => new Date(n - new Date(n).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
function IncidentView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [page, setPage] = useState(1); const [version, setVersion] = useState(0);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [reason, setReason] = useState('');
  useEffect(() => {
    let active = true; setData(null); setError('');
    void api<IncidentDetail>(`/admin/incidents/${id}?page=${page}`).then(value => {
      if (!active) return; setData(value);
      setStart(localTime(value.incident.startedAt)); setEnd(localTime(value.incident.resolvedAt ?? Date.now()));
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [id, page, version]);
  async function correct() {
    setBusy(true); setError('');
    try {
      await api(`/admin/incidents/${id}/corrections`, 'POST', { startedAt: new Date(start).getTime(), endedAt: new Date(end).getTime(), reason });
      setReason(''); setVersion(v => v + 1); onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function revoke(correctionId: string) {
    const why = window.prompt('오탐 정정을 취소하는 사유를 입력하세요.'); if (!why?.trim()) return;
    setBusy(true); setError('');
    try { await api(`/admin/incidents/${id}/corrections/${correctionId}/revoke`, 'POST', { reason: why }); setVersion(v => v + 1); onChanged(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title="장애 상세" description="원본 검사 결과와 정정 기록을 함께 확인합니다." onClose={onClose}><div className="modal-body">
    {error && <Notice>{error}<button className="text-button" onClick={() => setVersion(v => v + 1)}>다시 조회</button></Notice>}
    {!data && !error && <p>불러오는 중…</p>}
    {data && <>
      <h3>{data.incident.monitorName}</h3><p>{dateTime(data.incident.startedAt)} — {dateTime(data.incident.resolvedAt)}</p>
      <p>{data.incident.resolvedAt ? `${Math.round((data.incident.resolvedAt - data.incident.startedAt) / 1000)}초 · ${data.incident.resolutionCause === 'configuration' ? '설정 변경으로 종료' : '복구됨'}` : '장애 진행 중'}</p>
      <Notice type="info">최초 실패 사유: {data.incident.reason || '기록 없음'}</Notice>
      <section className="form-section"><h3>오탐 정정</h3><p>지정 구간을 가동률 계산에서 제외합니다. 원본은 보존되며, 이후 검사는 계속 반영됩니다. 장애 전체가 제외된 경우에만 공개 장애 목록에서 숨깁니다.</p>
        <form onSubmit={e => { e.preventDefault(); void correct(); }}><div className="form-grid">
          <label className="field">제외 시작<input aria-label="제외 시작" type="datetime-local" step="0.001" required value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="field">제외 종료<input aria-label="제외 종료" type="datetime-local" step="0.001" required value={end} onChange={e => setEnd(e.target.value)} /></label>
          <label className="field">처리 사유<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        </div><button className="button button-primary" disabled={busy}>오탐으로 정정</button></form>
      </section>
      <section className="form-section"><h3>정정 이력</h3>{data.corrections.length === 0 && <p>정정 기록이 없습니다.</p>}{data.corrections.map(c => <article className="history-entry" key={c.id}><strong>{c.revokedAt ? '취소된 정정' : '가동률 제외'}</strong><p>{dateTime(c.startedAt)} — {dateTime(c.endedAt)}</p><p>{c.reason}</p><small>처리: {dateTime(c.createdAt)}</small>{c.revokedAt ? <p>취소: {dateTime(c.revokedAt)} · {c.revokeReason}</p> : <button className="text-button" disabled={busy} onClick={() => void revoke(c.id)}>정정 취소</button>}</article>)}</section>
      <section className="form-section"><h3>장애 전후 검사 결과</h3><p>장애 구간과 앞뒤 1시간을 표시합니다.</p>
        {data.retentionCutoff !== null && data.incident.startedAt - 3600000 < data.retentionCutoff && <Notice type="info">{dateTime(data.retentionCutoff)} 이전의 개별 검사 기록은 보존 기간이 만료됐습니다. 장애 요약과 정정 기록은 유지됩니다.</Notice>}
        {data.checks.items.map(c => <div className="check-row" key={c.id}><span className={`check-outcome check-${c.outcome}`}>{c.outcome === 'up' ? '성공' : c.outcome === 'down' ? '실패' : '미확인'}</span><div><strong>{dateTime(c.checkedAt)}</strong><p>{c.message}</p></div><span>{c.latencyMs === null ? '—' : `${Math.round(c.latencyMs)} ms`}</span></div>)}
        {!data.checks.total && <p>조회 가능한 검사 기록이 없습니다.</p>}
        <Pager {...data.checks} onChange={setPage} />
      </section>
    </>}
  </div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>닫기</button></div></Modal>;
}
export function IncidentHistory({ monitors }: { monitors: AdminMonitor[] }) {
  const [monitorId, setMonitorId] = useState(''); const [state, setState] = useState('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminIncident> | null>(null); const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null); const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError('');
    const q = new URLSearchParams({ page: String(page), state }); if (monitorId) q.set('monitorId', monitorId);
    if (from) q.set('from', String(new Date(`${from}T00:00:00`).getTime()));
    if (to) q.set('to', String(new Date(`${to}T23:59:59.999`).getTime()));
    void api<Page<AdminIncident>>(`/admin/incidents?${q}`).then(v => { if (active) setData(v); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [page, monitorId, state, from, to, version]);
  return <section><h2>장애 이력</h2><p>저장된 전체 장애를 조회합니다. 날짜는 기기의 현지 시간 기준입니다.</p><div className="management-toolbar">
    <select aria-label="장애 모니터 필터" value={monitorId} onChange={e => { setMonitorId(e.target.value); setPage(1); }}><option value="">모든 모니터</option>{monitors.map(m => <option key={m.id} value={m.id}>{m.name}{m.archived ? ' (보관됨)' : ''}</option>)}</select>
    <select aria-label="장애 상태 필터" value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="all">모든 상태</option><option value="open">진행 중</option><option value="resolved">종료됨</option><option value="corrected">오탐 정정 있음</option></select>
    <label>시작일<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>종료일<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
  </div>{error && <Notice>{error}<button className="text-button" onClick={() => setVersion(v => v + 1)}>다시 시도</button></Notice>}
    {!data && !error && <p>불러오는 중…</p>}{data?.items.map(i => <article className="history-entry" key={i.id}><div><strong>{i.monitorName}</strong><span> · {i.resolvedAt ? i.resolutionCause === 'configuration' ? '설정 변경으로 종료' : '복구됨' : '진행 중'}{i.corrected > 0 ? ' · 오탐 정정 있음' : ''}</span></div><p>{dateTime(i.startedAt)} — {i.resolvedAt ? dateTime(i.resolvedAt) : '진행 중'}</p><p>{i.reason}</p><button className="button button-secondary" onClick={() => setSelected(i.id)}>상세 보기</button></article>)}
    {data && !data.total && <p>조건에 맞는 장애 이력이 없습니다.</p>}{data && <Pager {...data} onChange={setPage} />}
    {selected && <IncidentView id={selected} onClose={() => setSelected(null)} onChanged={() => setVersion(v => v + 1)} />}
  </section>;
}
