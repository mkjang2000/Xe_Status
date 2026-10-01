import { Code2, Globe2, Plus, Radio, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { defaultMonitor } from '../../shared/defaults';
import type { AdminMonitor, JsonOperator, JsonRule, MonitorInput, MonitorKind } from '../../shared/types';
import { api, errorMessage } from './api';
import { Field, Notice, Toggle } from './ui';

interface RuleDraft { path: string; operator: JsonOperator; value: string }
const kinds: { value: MonitorKind; label: string; description: string; icon: typeof Globe2 }[] = [
  { value: 'http', label: 'HTTP / HTTPS', description: '웹 응답 확인', icon: Globe2 },
  { value: 'json', label: 'JSON API', description: '응답 필드 확인', icon: Code2 },
  { value: 'ping', label: 'Ping', description: '서버 연결 확인', icon: Radio }
];

function localDateTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function parseRule(rule: RuleDraft): JsonRule {
  if (!rule.path.trim()) throw new Error('JSON 조건의 필드 경로를 입력해 주세요.');
  if (rule.operator === 'exists') return { path: rule.path.trim(), operator: rule.operator };
  let value: JsonRule['value'] = rule.value;
  try { value = JSON.parse(rule.value) as JsonRule['value']; } catch { /* Unquoted values are treated as text. */ }
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('비교 값에는 문자열, 숫자, true, false, null을 사용할 수 있습니다.');
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.operator) && typeof value !== 'number') throw new Error('크기 비교 조건에는 숫자를 입력해 주세요.');
  return { path: rule.path.trim(), operator: rule.operator, value };
}

export function MonitorForm({ monitor, onSaved, onCancel }: { monitor: AdminMonitor | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<MonitorInput>(() => monitor ? { ...monitor } : { ...defaultMonitor, headers: {}, rules: [] });
  const [headers, setHeaders] = useState(JSON.stringify(monitor?.headers ?? {}, null, 2));
  const [rules, setRules] = useState<RuleDraft[]>(() => (monitor?.rules ?? []).map(rule => ({ ...rule, value: typeof rule.value === 'string' ? JSON.stringify(rule.value) : String(rule.value ?? 'null') })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update<K extends keyof MonitorInput>(key: K, value: MonitorInput[K]) { setForm(current => ({ ...current, [key]: value })); }
  function updateRule(index: number, change: Partial<RuleDraft>) { setRules(current => current.map((rule, i) => i === index ? { ...rule, ...change } : rule)); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      let requestHeaders: Record<string, string> = {};
      if (form.kind !== 'ping') {
        try { requestHeaders = JSON.parse(headers) as Record<string, string>; } catch { throw new Error('요청 헤더를 올바른 JSON으로 입력해 주세요.'); }
        if (!requestHeaders || Array.isArray(requestHeaders) || typeof requestHeaders !== 'object' || Object.values(requestHeaders).some(value => typeof value !== 'string')) throw new Error('요청 헤더는 문자열 값을 가진 JSON 객체여야 합니다.');
      }
      if (form.timeoutSeconds >= form.intervalSeconds) throw new Error('타임아웃은 검사 주기보다 짧게 설정해 주세요.');
      if (form.kind === 'json' && rules.length === 0) throw new Error('JSON 응답에서 확인할 조건을 하나 이상 추가해 주세요.');
      const payload: MonitorInput = {
        name: form.name.trim(), description: form.description.trim(), target: form.target.trim(), kind: form.kind,
        intervalSeconds: form.intervalSeconds, timeoutSeconds: form.timeoutSeconds, failureThreshold: form.failureThreshold,
        recoveryThreshold: form.recoveryThreshold, enabled: form.enabled, maintenance: form.maintenance,
        maintenanceUntil: form.maintenance ? form.maintenanceUntil : null,
        method: form.kind === 'ping' ? 'GET' : form.method, headers: requestHeaders,
        body: form.kind !== 'ping' && form.method === 'POST' ? form.body : '', expectedStatus: form.expectedStatus,
        rules: form.kind === 'json' ? rules.map(parseRule) : [], sortOrder: form.sortOrder
      };
      setBusy(true);
      await api(`/admin/monitors${monitor ? `/${monitor.id}` : ''}`, monitor ? 'PUT' : 'POST', payload);
      onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="monitor-form">
    <div className="modal-body">
      {error && <Notice>{error}</Notice>}
      <div className="form-section"><h3>기본 정보</h3><div className="form-grid">
        <Field label="서비스 이름"><input autoFocus required maxLength={100} value={form.name} onChange={e => update('name', e.target.value)} placeholder="예: API 서버" /></Field>
        <Field label="표시 순서" hint="작은 숫자부터 표시합니다."><input type="number" min={-1000} max={1000} required value={form.sortOrder} onChange={e => update('sortOrder', Number(e.target.value))} /></Field>
        <Field label="설명 (선택)" wide><input maxLength={500} value={form.description} onChange={e => update('description', e.target.value)} placeholder="공개 페이지에 표시할 짧은 설명" /></Field>
      </div></div>
      <div className="form-section"><h3>검사 방식</h3><div className="kind-options">{kinds.map(kind => <button type="button" key={kind.value} className={`kind-option ${form.kind === kind.value ? 'selected' : ''}`} aria-pressed={form.kind === kind.value} onClick={() => { update('kind', kind.value); if (kind.value === 'json' && form.method === 'HEAD') update('method', 'GET'); }}><kind.icon size={20} /><strong>{kind.label}</strong><small>{kind.description}</small></button>)}</div>
        <div className="form-grid">
          <Field label={form.kind === 'ping' ? '호스트 / IP 주소' : '검사 URL'} hint="외부에서 접근할 수 있는 공개 주소를 입력하세요." wide><input required type={form.kind === 'ping' ? 'text' : 'url'} value={form.target} onChange={e => update('target', e.target.value)} placeholder={form.kind === 'ping' ? 'example.com' : 'https://example.com/health'} /></Field>
          {form.kind !== 'ping' && <><Field label="HTTP 메서드"><select value={form.method} onChange={e => update('method', e.target.value as MonitorInput['method'])}><option>GET</option>{form.kind !== 'json' && <option>HEAD</option>}<option>POST</option></select></Field><Field label="정상 응답 코드"><input type="number" min={100} max={599} required value={form.expectedStatus} onChange={e => update('expectedStatus', Number(e.target.value))} /></Field></>}
        </div>
        {form.kind === 'json' && <div className="json-rules"><div className="inline-heading"><h4>JSON 필드 조건</h4><button type="button" className="text-button" onClick={() => setRules(current => [...current, { path: '', operator: 'eq', value: '"ok"' }])}><Plus size={14} />조건 추가</button></div><p className="field-hint">모든 조건을 충족해야 정상입니다. 중첩 필드는 database.connected처럼 입력하세요.</p>
          {rules.length === 0 && <p className="rule-empty">검사할 필드 조건을 추가해 주세요.</p>}
          {rules.map((rule, index) => <div className="rule-row" key={index}><input aria-label={`조건 ${index + 1} 필드 경로`} required value={rule.path} onChange={e => updateRule(index, { path: e.target.value })} placeholder="status" /><select aria-label={`조건 ${index + 1} 비교 방식`} value={rule.operator} onChange={e => updateRule(index, { operator: e.target.value as JsonOperator })}><option value="eq">같음 (=)</option><option value="ne">다름 (≠)</option><option value="gt">초과 (&gt;)</option><option value="gte">이상 (≥)</option><option value="lt">미만 (&lt;)</option><option value="lte">이하 (≤)</option><option value="exists">필드 존재</option></select><input aria-label={`조건 ${index + 1} 비교 값`} disabled={rule.operator === 'exists'} value={rule.value} onChange={e => updateRule(index, { value: e.target.value })} placeholder='"ok" / true / 100' /><button type="button" className="icon-button danger-text" aria-label={`조건 ${index + 1} 삭제`} onClick={() => setRules(current => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}
        </div>}
        {form.kind !== 'ping' && <details className="advanced-settings"><summary>요청 헤더{form.method === 'POST' ? ' 및 본문' : ''}</summary><div className="form-grid"><Field label="요청 헤더 (JSON)" hint="인증 헤더는 공개 페이지에 표시되지 않습니다." wide><textarea className="code-input" rows={4} value={headers} onChange={e => setHeaders(e.target.value)} spellCheck={false} placeholder={'{ "Authorization": "Bearer …" }'} /></Field>{form.method === 'POST' && <Field label="요청 본문" wide><textarea className="code-input" rows={4} value={form.body} onChange={e => update('body', e.target.value)} spellCheck={false} placeholder={'{ "check": true }'} /></Field>}</div></details>}
      </div>
      <div className="form-section"><h3>검사 주기와 상태 전환</h3><div className="form-grid">
        <Field label="검사 주기 (초)"><input type="number" required min={15} max={3600} value={form.intervalSeconds} onChange={e => update('intervalSeconds', Number(e.target.value))} /></Field>
        <Field label="타임아웃 (초)"><input type="number" required min={1} max={60} value={form.timeoutSeconds} onChange={e => update('timeoutSeconds', Number(e.target.value))} /></Field>
        <Field label="연속 실패 시 장애 (회)"><input type="number" required min={1} max={10} value={form.failureThreshold} onChange={e => update('failureThreshold', Number(e.target.value))} /></Field>
        <Field label="연속 성공 시 복구 (회)"><input type="number" required min={1} max={10} value={form.recoveryThreshold} onChange={e => update('recoveryThreshold', Number(e.target.value))} /></Field>
      </div></div>
      <div className="form-section"><h3>운영 설정</h3><Toggle checked={form.enabled} onChange={value => update('enabled', value)} title="모니터링 활성화" description="비활성화하면 검사를 멈추고 미확인으로 표시합니다." /><Toggle checked={form.maintenance} onChange={value => update('maintenance', value)} title="점검 모드" description="검사는 계속하며, 점검 중에는 장애·복구 알림을 보내지 않습니다." />{form.maintenance && <Field label="점검 종료 시각 (선택)" hint="기기의 현지 시간 기준입니다. 비워두면 직접 종료할 때까지 유지됩니다."><input type="datetime-local" value={localDateTime(form.maintenanceUntil)} onChange={e => update('maintenanceUntil', e.target.value ? new Date(e.target.value).getTime() : null)} /></Field>}</div>
    </div>
    <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>취소</button><button className="button button-primary" disabled={busy}>{busy ? '저장 중…' : monitor ? '변경 사항 저장' : '서비스 추가'}</button></div>
  </form>;
}
