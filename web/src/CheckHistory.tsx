import { useEffect, useState } from 'react';
import type { AdminMonitor, CheckRecord, Page } from '../../shared/types';
import { api, errorMessage } from './api';
import { dateTime, Modal, Notice } from './ui';
import { Pager } from './IncidentHistory';

export function CheckHistory({ monitor, onClose }: { monitor: AdminMonitor; onClose: () => void }) {
  const [data, setData] = useState<(Page<CheckRecord> & { retentionCutoff: number | null }) | null>(null);
  const [page, setPage] = useState(1); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError('');
    const q = new URLSearchParams({ page: String(page) });
    if (from) q.set('from', String(new Date(`${from}T00:00:00`).getTime()));
    if (to) q.set('to', String(new Date(`${to}T23:59:59.999`).getTime()));
    void api<Page<CheckRecord> & { retentionCutoff: number | null }>(`/admin/monitors/${monitor.id}/check-history?${q}`).then(v => { if (active) setData(v); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [monitor.id, page, from, to, version]);
  return <Modal title={`${monitor.name} · 검사 기록`} description="보존 중인 검사 결과를 조회합니다. 날짜는 기기의 현지 시간 기준입니다." onClose={onClose}><div className="modal-body">
    <div className="management-toolbar"><label>시작일<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>종료일<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div>
    {error && <Notice>{error}<button className="text-button" onClick={() => setVersion(v => v + 1)}>다시 시도</button></Notice>}
    {!data && !error && <p>불러오는 중…</p>}{data?.retentionCutoff != null && <p>{dateTime(data.retentionCutoff)} 이전의 검사 기록은 보존 기간이 만료되었습니다.</p>}
    {data?.items.map(c => <div className="check-row" key={c.id}><span className={`check-outcome check-${c.outcome}`}>{c.outcome === 'up' ? '성공' : c.outcome === 'down' ? '실패' : '미확인'}</span><div><strong>{dateTime(c.checkedAt)}</strong><p>{c.message || '정상 응답'}</p></div><span>{c.latencyMs === null ? '—' : `${Math.round(c.latencyMs)} ms`}</span></div>)}
    {data && !data.total && <p>조건에 맞는 검사 기록이 없습니다.</p>}{data && <Pager {...data} onChange={setPage} />}
  </div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>닫기</button></div></Modal>;
}
