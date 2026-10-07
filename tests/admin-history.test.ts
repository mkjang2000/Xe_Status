import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { openDatabase, saveMonitor, getMonitor, getSetting } from '../server/db.js';
import { defaultMonitor } from '../shared/defaults.js';
import { publicStatus } from '../server/status.js';
import { calculateHistory } from '../server/availability.js';
import { claimMonitors, pruneHistory, recordCheck } from '../worker/state.js';

process.env.ADMIN_PASSWORD = 'test-password-at-least-twelve';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const db = openDatabase(':memory:'); const app = await buildApp(db);
  t.after(async () => { await app.close(); db.close(); });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: process.env.APP_ORIGIN }, payload: { password: process.env.ADMIN_PASSWORD } });
  const headers = { origin: process.env.APP_ORIGIN!, cookie: String(login.headers['set-cookie']).split(';')[0] };
  const monitor = saveMonitor(db, { ...defaultMonitor, name: 'API', target: 'https://example.com' });
  const now = Date.now(); const start = now - 120000;
  db.prepare('INSERT INTO incidents(id,monitor_id,monitor_name,started_at,resolved_at,reason) VALUES(?,?,?,?,?,?)').run('incident', monitor.id, monitor.name, start, now - 60000, 'private diagnostic');
  db.prepare('INSERT INTO checks(monitor_id,checked_at,outcome,message,interval_seconds) VALUES(?,?,?,?,?)').run(monitor.id, start, 'down', 'failure', 60);
  db.prepare('INSERT INTO checks(monitor_id,checked_at,outcome,message,interval_seconds) VALUES(?,?,?,?,?)').run(monitor.id, now - 60000, 'up', 'ok', 60);
  return { db, app, headers, monitor, now, start };
}
test('history pagination, overlap filters, validation and authentication', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++) f.db.prepare('INSERT INTO incidents(id,monitor_id,monitor_name,started_at,resolved_at) VALUES(?,?,?,?,?)').run(`old-${i}`, f.monitor.id, 'API', f.start - (i + 1) * 100000, f.start - i * 100000);
  assert.equal((await f.app.inject('/api/admin/incidents')).statusCode, 401);
  const first = (await f.app.inject({ url: '/api/admin/incidents?pageSize=20', headers: f.headers })).json();
  const next = (await f.app.inject({ url: '/api/admin/incidents?pageSize=20&page=2', headers: f.headers })).json();
  assert.equal(first.total, 31); assert.equal(next.items.length, 11);
  assert.equal(new Set([...first.items, ...next.items].map(i => i.id)).size, 31);
  assert.equal((await f.app.inject({ url: '/api/admin/incidents?page=0', headers: f.headers })).statusCode, 400);
  assert.equal((await f.app.inject({ url: `/api/admin/incidents?from=${f.start + 1}&to=${f.now}`, headers: f.headers })).json().total, 1);
  const detail = (await f.app.inject({ url: '/api/admin/incidents/incident', headers: f.headers })).json();
  assert.equal(detail.incident.reason, 'private diagnostic'); assert.equal(detail.checks.items.length, 2);
  assert.equal(JSON.stringify(publicStatus(f.db, f.now)).includes('private diagnostic'), false);
  assert.equal((await f.app.inject({ url: `/api/admin/monitors/${f.monitor.id}/check-history?pageSize=1&page=2`, headers: f.headers })).json().items[0].outcome, 'down');
});
test('correction excludes raw coverage, hides fully corrected incident, revocation restores it and preserves audit', async t => {
  const f = await fixture(t);
  const payload = { startedAt: f.start, endedAt: f.now - 60000, reason: '측정 오류' };
  assert.equal(publicStatus(f.db, f.now).monitors[0].history.at(-1)?.uptime, 50);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: { ...f.headers, origin: 'https://bad.example' }, payload })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: f.headers, payload: { ...payload, endedAt: f.now } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: f.headers, payload })).statusCode, 201);
  const corrected = publicStatus(f.db, f.now);
  assert.equal(corrected.monitors[0].history.at(-1)?.uptime, 100); assert.equal(corrected.incidents.length, 0);
  assert.equal((f.db.prepare("SELECT count(*) AS n FROM checks WHERE outcome='down'").get() as { n: number }).n, 1);
  const id = (f.db.prepare('SELECT id FROM incident_corrections').get() as { id: string }).id;
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/incidents/incident/corrections/${id}/revoke`, headers: f.headers, payload: { reason: '실제 장애로 확인' } })).statusCode, 200);
  assert.equal(publicStatus(f.db, f.now).monitors[0].history.at(-1)?.uptime, 50);
  assert.equal(publicStatus(f.db, f.now).incidents.length, 1);
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/incidents/incident/corrections/${id}/revoke`, headers: f.headers, payload: { reason: '중복' } })).statusCode, 409);
});
test('open incident correction has a fixed end and subsequent failures remain visible', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE incidents SET resolved_at=NULL').run();
  f.db.prepare('UPDATE monitors SET last_check_at=? WHERE id=?').run(f.start, f.monitor.id);
  const end = f.now - 30000;
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: f.headers, payload: { startedAt: f.start, endedAt: end, reason: '일시 측정 오류' } })).statusCode, 201);
  assert.equal(publicStatus(f.db, f.now).incidents.length, 0);
  f.db.prepare('UPDATE monitors SET last_check_at=? WHERE id=?').run(f.now, f.monitor.id);
  assert.equal(publicStatus(f.db, f.now).incidents.length, 1);
});
test('bulk changes are atomic; archive keeps history, discards outstanding claims and restore remains paused', async t => {
  const f = await fixture(t);
  const post = (payload: Record<string, unknown>) => f.app.inject({ method: 'POST', url: '/api/admin/monitors/bulk', headers: f.headers, payload });
  assert.equal((await post({ ids: [f.monitor.id, 'missing'], action: 'archive' })).statusCode, 404);
  assert.equal(getMonitor(f.db, f.monitor.id)?.enabled, true);
  const claim = claimMonitors(f.db, f.now + 1)[0];
  assert.equal((await post({ ids: [f.monitor.id], action: 'archive' })).statusCode, 200);
  assert.equal(recordCheck(f.db, claim, { outcome: 'down', latencyMs: null, message: 'late' }, f.now + 2), false);
  assert.equal(publicStatus(f.db, f.now).monitors.length, 0); assert.equal(publicStatus(f.db, f.now).incidents.length, 0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM incidents').get() as { n: number }).n, 1);
  assert.equal((await post({ ids: [f.monitor.id], action: 'enable' })).statusCode, 409);
  assert.equal((await post({ ids: [f.monitor.id], action: 'restore' })).statusCode, 200);
  assert.equal(getMonitor(f.db, f.monitor.id)?.enabled, false);
  assert.equal((await post({ ids: [f.monitor.id], action: 'group', group: '운영' })).statusCode, 200);
  assert.equal(getMonitor(f.db, f.monitor.id)?.group, '운영');
  assert.equal((await post({ ids: [f.monitor.id], action: 'maintenance', until: f.now + 60000 })).statusCode, 200);
  assert.equal(getMonitor(f.db, f.monitor.id)?.maintenance, true);
});
test('incident summaries and corrections survive retention while raw checks expire', async t => {
  const f = await fixture(t);
  await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: f.headers, payload: { startedAt: f.start, endedAt: f.now - 60000, reason: '측정 오류' } });
  pruneHistory(f.db, f.now + 100 * 86400000);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM checks').get() as { n: number }).n, 0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM incidents').get() as { n: number }).n, 1);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM incident_corrections').get() as { n: number }).n, 1);
  assert.ok(getSetting(f.db, 'checks_retention_cutoff', 0) > f.now);
});
test('overlapping exclusions merge, clip at midnight, and never fabricate success', () => {
  const midnight = Date.parse('2026-10-04T15:00:00Z');
  const samples = [{ checkedAt: midnight - 30000, intervalSeconds: 60, outcome: 'down' as const }];
  const result = calculateHistory(samples, midnight + 30000, [
    { startedAt: midnight - 60000, endedAt: midnight + 10000 }, { startedAt: midnight, endedAt: midnight + 60000 }
  ]);
  assert.equal(result.at(-1)?.uptime, null); assert.equal(result.at(-2)?.uptime, null);
  const partial = calculateHistory(samples, midnight + 30000, [{ startedAt: midnight - 15000, endedAt: midnight + 15000 }]);
  assert.equal(partial.at(-1)?.uptime, 0); assert.equal(partial.at(-2)?.uptime, 0);
});
test('additive migration reopens legacy database without losing configuration or history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xe-migration-')); const path = join(dir, 'status.db');
  try {
    let db = openDatabase(path); const m = saveMonitor(db, { ...defaultMonitor, name: 'Legacy', target: 'https://example.com' });
    db.exec('DROP TABLE incident_corrections'); db.close();
    db = openDatabase(path); assert.equal(getMonitor(db, m.id)?.group, ''); assert.equal(getMonitor(db, m.id)?.archived, false);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='incident_corrections'").get()); db.close();
    db = openDatabase(path); assert.equal(getMonitor(db, m.id)?.name, 'Legacy'); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ordering persists and partial corrections do not hide remaining incident coverage', async t => {
  const f = await fixture(t);
  const second = saveMonitor(f.db, { ...defaultMonitor, name: 'Z API', target: 'https://example.com' });
  const claim = claimMonitors(f.db, f.now + 1)[0];
  const moved = await f.app.inject({ method: 'POST', url: `/api/admin/monitors/${second.id}/move`, headers: f.headers, payload: { direction: 'up' } });
  assert.equal(moved.statusCode, 200);
  assert.equal(publicStatus(f.db, f.now).monitors[0].id, second.id);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/incidents/incident/corrections', headers: f.headers, payload: { startedAt: f.start, endedAt: f.start + 30000, reason: '앞부분만 측정 오류' } })).statusCode, 201);
  assert.equal(publicStatus(f.db, f.now).incidents.length, 1);
  assert.ok(Math.abs(publicStatus(f.db, f.now).monitors.find(m => m.id === f.monitor.id)!.history.at(-1)!.uptime! - 200 / 3) < 0.001);
  assert.ok(claim);
});
