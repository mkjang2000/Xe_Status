import { randomUUID } from 'node:crypto';
import { getMonitor, getMonitors, getSetting, type Db } from '../server/db.js';
import { defaultSmtp } from '../shared/defaults.js';
import type { CheckResult, MonitorRecord } from '../shared/types.js';

export function isMaintenance(monitor: MonitorRecord, now: number): boolean {
  return monitor.maintenance && (monitor.maintenanceUntil === null || monitor.maintenanceUntil > now);
}
export function isStale(monitor: MonitorRecord, now: number): boolean {
  return monitor.lastCheckAt === null || monitor.lastCheckAt + (monitor.intervalSeconds + monitor.timeoutSeconds) * 1000 + 5000 < now;
}

export function claimMonitors(db: Db, now: number, limit = 5): MonitorRecord[] {
  return db.transaction(() => {
    const due = getMonitors(db).filter(m => m.enabled && m.nextCheckAt <= now && m.leaseUntil <= now)
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt).slice(0, limit);
    return due.map(monitor => {
      const leaseUntil = now + Math.max(1, Math.min(60, monitor.timeoutSeconds)) * 1000 + 30_000;
      db.prepare('UPDATE monitors SET lease_until=? WHERE id=?').run(leaseUntil, monitor.id);
      return { ...monitor, leaseUntil };
    });
  }).immediate();
}

interface Incident { id: string; started_at: number; notification_sent: number }
export interface MailPayload { subject: string; text: string }

export function enqueueMail(db: Db, kind: 'down' | 'up' | 'test', monitorId: string | null, payload: MailPayload, now: number): string {
  const id = randomUUID();
  db.prepare('INSERT INTO outbox(id,monitor_id,kind,payload,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)')
    .run(id, monitorId, kind, JSON.stringify(payload), now, now);
  return id;
}

function eventMail(kind: 'down' | 'up', monitor: MonitorRecord, incident: Incident, message: string, now: number): MailPayload {
  const label = kind === 'down' ? '장애 발생' : '정상 복구';
  const name = monitor.name.replace(/[\r\n]/g, ' ');
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  const time = (date: number) => new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) + ' KST';
  const duration = kind === 'up' ? `\n장애 지속: ${Math.max(0, Math.round((now - incident.started_at) / 1000))}초` : '';
  return {
    subject: `[XE Status] ${name} ${label}`,
    text: `${name}: ${label}\n발생 시각: ${time(incident.started_at)}${kind === 'up' ? `\n복구 시각: ${time(now)}` : ''}${duration}\n${message}\n\n상태 페이지: ${origin}`
  };
}

function streakStart(db: Db, monitorId: string, count: number, fallback: number): number {
  const row = db.prepare('SELECT checked_at FROM checks WHERE monitor_id=? ORDER BY checked_at DESC, id DESC LIMIT 1 OFFSET ?')
    .get(monitorId, Math.max(0, count - 1)) as { checked_at: number } | undefined;
  return row?.checked_at ?? fallback;
}

/** Persist only results from the current configuration and current unexpired claim. */
export function recordCheck(db: Db, claim: MonitorRecord, result: CheckResult, now: number): boolean {
  return db.transaction(() => {
    const monitor = getMonitor(db, claim.id);
    if (!monitor?.enabled || monitor.revision !== claim.revision || monitor.leaseUntil !== claim.leaseUntil || monitor.leaseUntil < now) return false;
    const stale = isStale(monitor, now);
    const failures = result.outcome === 'down' ? (stale ? 0 : monitor.failures) + 1 : 0;
    const successes = result.outcome === 'up' ? (stale ? 0 : monitor.successes) + 1 : 0;
    let incident = db.prepare('SELECT id,started_at,notification_sent FROM incidents WHERE monitor_id=? AND resolved_at IS NULL')
      .get(monitor.id) as Incident | undefined;
    let status = stale ? 'unknown' as const : monitor.status;
    if (result.outcome === 'unknown') status = 'unknown';
    else if (failures >= monitor.failureThreshold) status = 'down';
    else if (result.outcome === 'up' && (!incident || successes >= monitor.recoveryThreshold)) status = 'operational';
    db.prepare(`INSERT INTO checks(monitor_id,checked_at,outcome,latency_ms,message,interval_seconds) VALUES(?,?,?,?,?,?)`)
      .run(monitor.id, now, result.outcome, result.latencyMs, result.message, monitor.intervalSeconds);
    db.prepare('UPDATE monitors SET status=?, failures=?, successes=?, last_check_at=?, next_check_at=?, lease_until=0 WHERE id=?')
      .run(status, failures, successes, now, now + Math.max(5, monitor.intervalSeconds) * 1000, monitor.id);

    const maintenance = isMaintenance(monitor, now);
    const smtpEnabled = getSetting(db, 'smtp', defaultSmtp).enabled;
    if (status === 'down' && !incident) {
      incident = { id: randomUUID(), started_at: streakStart(db, monitor.id, failures, now), notification_sent: 0 };
      db.prepare('INSERT INTO incidents(id,monitor_id,monitor_name,started_at,suppressed,reason) VALUES(?,?,?,?,?,?)')
        .run(incident.id, monitor.id, monitor.name, incident.started_at, maintenance ? 1 : 0, result.message);
    }
    if (incident && status === 'down' && !maintenance && !incident.notification_sent && smtpEnabled) {
      enqueueMail(db, 'down', monitor.id, eventMail('down', monitor, incident, result.message, now), now);
      db.prepare('UPDATE incidents SET notification_sent=1,suppressed=0 WHERE id=?').run(incident.id);
    }
    if (incident && status === 'operational') {
      const recoveredAt = streakStart(db, monitor.id, successes, now);
      db.prepare('UPDATE incidents SET resolved_at=? WHERE id=?').run(recoveredAt, incident.id);
      if (!maintenance && incident.notification_sent && smtpEnabled) {
        enqueueMail(db, 'up', monitor.id, eventMail('up', monitor, incident, result.message, recoveredAt), now);
      }
    }
    return true;
  }).immediate();
}

export function heartbeat(db: Db, now: number): void {
  db.prepare('INSERT INTO worker_state(id,last_tick) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick').run(now);
}

export function pruneHistory(db: Db, now: number, retentionDays = 90): void {
  const cutoff = now - Math.max(30, retentionDays) * 86_400_000;
  db.transaction(() => {
    db.prepare('DELETE FROM checks WHERE checked_at < ?').run(cutoff);
    db.prepare('DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?').run(cutoff);
    db.prepare("DELETE FROM outbox WHERE created_at < ? AND status IN ('sent','failed','cancelled')").run(cutoff);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  })();
}
