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
  const records = getMonitors(db);
  const history = db.prepare(`SELECT checked_at AS checkedAt, outcome, interval_seconds AS intervalSeconds
    FROM checks WHERE monitor_id=? AND checked_at>=? AND checked_at<=? ORDER BY checked_at,id`);
  const monitors = records.map(monitor => ({
    id: monitor.id, name: monitor.name, description: monitor.description,
    status: displayStatus(monitor, now), lastCheckAt: monitor.lastCheckAt,
    history: calculateHistory(history.iterate(monitor.id, historyStart(now) - 3_600_000, now) as Iterable<AvailabilitySample>, now)
  }));
  const priority: ServiceStatus[] = ['down', 'maintenance', 'unknown', 'operational'];
  const overall = priority.find(status => monitors.some(monitor => monitor.status === status)) ?? 'unknown';
  const incidents = db.prepare(`SELECT id, monitor_name AS monitorName, started_at AS startedAt,
    resolved_at AS resolvedAt, resolution_cause AS resolutionCause FROM incidents ORDER BY started_at DESC LIMIT 20`).all() as PublicIncident[];
  const checked = records.flatMap(monitor => monitor.lastCheckAt === null ? [] : [monitor.lastCheckAt]);
  return { branding: getSetting(db, 'branding', defaultBranding), overall, monitors, incidents, updatedAt: now,
    lastCheckAt: checked.length ? Math.max(...checked) : null };
}
