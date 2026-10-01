import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from './secrets.js';
import type { MonitorInput, MonitorRecord, CheckRecord } from '../shared/types.js';
export type Db = Database.Database;
export function openDatabase(path = process.env.DATABASE_PATH || './data/status.db'): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma('busy_timeout = 5000'); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown',
      failures INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
      last_check_at INTEGER, next_check_at INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      checked_at INTEGER NOT NULL, outcome TEXT NOT NULL, latency_ms REAL, message TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS checks_monitor_time ON checks(monitor_id, checked_at);
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      monitor_name TEXT NOT NULL, started_at INTEGER NOT NULL, resolved_at INTEGER,
      notification_sent INTEGER NOT NULL DEFAULT 0, suppressed INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
      resolution_cause TEXT NOT NULL DEFAULT 'recovered'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_incident ON incidents(monitor_id) WHERE resolved_at IS NULL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_tick INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
      lease_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS outbox_monitor_status ON outbox(monitor_id, status);
    CREATE INDEX IF NOT EXISTS incidents_started ON incidents(started_at);
  `);
  return db;
}
interface MonitorRow {
  id: string; config: string; status: MonitorRecord['status']; failures: number; successes: number;
  last_check_at: number | null; next_check_at: number; lease_until: number; revision: number;
}
export function getMonitors(db: Db): MonitorRecord[] {
  return (db.prepare('SELECT * FROM monitors').all() as MonitorRow[]).map(decodeMonitor)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
export function getMonitor(db: Db, id: string): MonitorRecord | undefined {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow | undefined;
  return row && decodeMonitor(row);
}
function decodeMonitor(row: MonitorRow): MonitorRecord {
  return { ...JSON.parse(decrypt(row.config)) as MonitorInput, id: row.id, status: row.status,
    failures: row.failures, successes: row.successes, lastCheckAt: row.last_check_at,
    nextCheckAt: row.next_check_at, leaseUntil: row.lease_until, revision: row.revision };
}
export function saveMonitor(db: Db, input: MonitorInput, id: string = randomUUID(), now = Date.now()): MonitorRecord {
  return db.transaction(() => {
    const previous = getMonitor(db, id);
    db.prepare(`INSERT INTO monitors(id, config, next_check_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET config=excluded.config, next_check_at=excluded.next_check_at,
      lease_until=0, revision=revision+1`).run(id, encrypt(JSON.stringify(input)), now);
    const probeChanged = previous && ['kind', 'target', 'method', 'headers', 'body', 'expectedStatus', 'rules', 'enabled', 'intervalSeconds', 'timeoutSeconds']
      .some(k => JSON.stringify(previous[k as keyof MonitorInput]) !== JSON.stringify(input[k as keyof MonitorInput]));
    if (probeChanged) {
      db.prepare("UPDATE monitors SET status='unknown', failures=0, successes=0, last_check_at=NULL WHERE id=?").run(id);
      db.prepare("INSERT INTO checks(monitor_id, checked_at, outcome, latency_ms, message, interval_seconds) VALUES (?, ?, 'unknown', NULL, '설정 변경 또는 일시정지', ?)").run(id, now, input.intervalSeconds);
      db.prepare("UPDATE incidents SET resolved_at=?, resolution_cause='configuration' WHERE monitor_id=? AND resolved_at IS NULL").run(now, id);
      db.prepare("UPDATE outbox SET status='cancelled' WHERE monitor_id=? AND status IN ('pending','sending')").run(id);
    }
    const maintenanceActive = input.maintenance && (input.maintenanceUntil === null || input.maintenanceUntil > now);
    const previouslyActive = previous?.maintenance && (previous.maintenanceUntil === null || previous.maintenanceUntil > now);
    if (maintenanceActive && !previouslyActive) {
      db.prepare("UPDATE outbox SET status='cancelled' WHERE monitor_id=? AND status IN ('pending','sending') AND kind IN ('down','up')").run(id);
      db.prepare('UPDATE incidents SET suppressed=1, notification_sent=0 WHERE monitor_id=? AND resolved_at IS NULL').run(id);
    }
    return getMonitor(db, id)!;
  }).immediate();
}
export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  if (!row) return structuredClone(fallback);
  return JSON.parse(key === 'smtp' ? decrypt(row.value) : row.value) as T;
}
export function setSetting(db: Db, key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, key === 'smtp' ? encrypt(serialized) : serialized);
}
export function getChecks(db: Db, monitorId: string, limit = 50): CheckRecord[] {
  return db.prepare(`SELECT id, monitor_id AS monitorId, checked_at AS checkedAt, outcome,
    latency_ms AS latencyMs, message, interval_seconds AS intervalSeconds
    FROM checks WHERE monitor_id=? ORDER BY checked_at DESC, id DESC LIMIT ?`).all(monitorId, limit) as CheckRecord[];
}
