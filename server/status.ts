import { exclusions, fullyCorrected } from './incidents.js';
import type { AdminMonitor, MonitorRecord, PublicStatus, ServiceStatus, PublicIncident } from '../shared/types.js';
import { defaultBranding } from '../shared/defaults.js';
import { getChecks, getMonitors, getSetting, type Db } from './db.js';
import { calculateHistory, historyStart, type AvailabilitySample } from './availability.js';

export function displayStatus(monitor: MonitorRecord, now = Date.now()): ServiceStatus {
  if (!monitor.enabled) return 'unknown';
  if (monitor.maintenance && (monitor.maintenanceUntil === null || monitor.maintenanceUntil > now)) return 'maintenance';
  if (monitor.lastCheckAt === null || now > monitor.lastCheckAt + (monitor.intervalSeconds + monitor.timeoutSeconds) * 1000 + 5000) return 'unknown';
  return monitor.status;
}
export function asAdminMonitor(db: Db, monitor: MonitorRecord): AdminMonitor {
  return { ...monitor, displayStatus: displayStatus(monitor), lastResult: getChecks(db, monitor.id, 1)[0] ?? null };
}
export function publicStatus(db: Db, now = Date.now()): PublicStatus {
  const records = getMonitors(db).filter(m => !m.archived);
  const history = db.prepare(`SELECT checked_at AS checkedAt, outcome, interval_seconds AS intervalSeconds
    FROM checks WHERE monitor_id=? AND checked_at>=? AND checked_at<=? ORDER BY checked_at,id`);
  const monitors = records.map(monitor => ({
    id: monitor.id, name: monitor.name, description: monitor.description,
    status: displayStatus(monitor, now), lastCheckAt: monitor.lastCheckAt,
    history: calculateHistory(history.iterate(monitor.id, historyStart(now) - 3_600_000, now) as Iterable<AvailabilitySample>, now, exclusions(db, monitor.id, historyStart(now), now))
  }));
  const priority: ServiceStatus[] = ['down', 'maintenance', 'unknown', 'operational'];
  const overall = priority.find(status => monitors.some(monitor => monitor.status === status)) ?? 'unknown';
  const candidates = db.prepare(`SELECT id, monitor_id AS monitorId, monitor_name AS monitorName, started_at AS startedAt,
    resolved_at AS resolvedAt, resolution_cause AS resolutionCause FROM incidents WHERE monitor_id IN (${records.map(() => '?').join(',') || 'NULL'}) ORDER BY started_at DESC,id DESC`);
  const byId = new Map(records.map(m => [m.id, m]));
  const incidents: PublicIncident[] = [];
  for (const row of candidates.iterate(...records.map(m => m.id)) as Iterable<PublicIncident & { monitorId: string }>) {
    const monitor = byId.get(row.monitorId);
    if (!monitor || fullyCorrected(db, row.id, row.startedAt, row.resolvedAt ?? Math.max(row.startedAt, monitor.lastCheckAt ?? now))) continue;
    const { monitorId: _privateId, ...incident } = row;
    incidents.push(incident);
    if (incidents.length === 20) break;
  }
  const checked = records.flatMap(monitor => monitor.lastCheckAt === null ? [] : [monitor.lastCheckAt]);
  return { branding: getSetting(db, 'branding', defaultBranding), overall, monitors, incidents, updatedAt: now,
    lastCheckAt: checked.length ? Math.max(...checked) : null };
}
