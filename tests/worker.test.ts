import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, saveMonitor, getMonitor, getChecks, setSetting, type Db } from '../server/db.js';
import { defaultMonitor, defaultSmtp } from '../shared/defaults.js';
import type { CheckOutcome, CheckResult, MonitorInput } from '../shared/types.js';
import { claimMonitors, enqueueMail, recordCheck, pruneHistory } from '../worker/state.js';
import { claimMail, completeMail, dispatchMail } from '../worker/mail.js';
import { createWorker } from '../worker/scheduler.js';

process.env.ENCRYPTION_KEY = 'b'.repeat(64);
function fixture(overrides: Partial<MonitorInput> = {}) {
  const db = openDatabase(':memory:');
  const input = { ...defaultMonitor, name: 'API', target: 'https://example.com', intervalSeconds: 10, timeoutSeconds: 2,
    failureThreshold: 2, recoveryThreshold: 2, ...overrides };
  saveMonitor(db, input, 'monitor', 100_000);
  setSetting(db, 'smtp', { ...defaultSmtp, enabled: true });
  let current = 100_000;
  return {
    db, input,
    get time() { return current; },
    apply(outcome: CheckOutcome, gap = 0) {
      current = Math.max(current + gap, getMonitor(db, 'monitor')!.nextCheckAt);
      const [claim] = claimMonitors(db, current);
      assert.ok(claim);
      current += 1;
      assert.equal(recordCheck(db, claim, { outcome, latencyMs: outcome === 'unknown' ? null : 10, message: 'test result' }, current), true);
      return getMonitor(db, 'monitor')!;
    }
  };
}
function count(db: Db, table: string): number { return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total; }

test('raw failures are retained while incident and recovery notifications use thresholds once', () => {
  const f = fixture();
  try {
    assert.equal(f.apply('up').status, 'operational');
    assert.equal(f.apply('down').status, 'operational');
    const firstFailureAt = f.time;
    assert.equal(f.apply('down').status, 'down');
    assert.equal(count(f.db, 'incidents'), 1); assert.equal(count(f.db, 'outbox'), 1);
    assert.equal((f.db.prepare('SELECT started_at FROM incidents').get() as { started_at: number }).started_at, firstFailureAt);
    f.apply('down'); assert.equal(count(f.db, 'outbox'), 1);
    assert.equal(f.apply('up').status, 'down');
    assert.equal(f.apply('up').status, 'operational');
    assert.equal(count(f.db, 'outbox'), 2);
    assert.deepEqual(getChecks(f.db, 'monitor').map(c => c.outcome), ['up', 'up', 'down', 'down', 'down', 'up']);
    assert.equal((f.db.prepare('SELECT resolved_at FROM incidents').get() as { resolved_at: number }).resolved_at > firstFailureAt, true);
  } finally { f.db.close(); }
});

test('unknown and stale gaps reset streaks without manufacturing recovery', () => {
  const f = fixture();
  try {
    f.apply('down'); assert.equal(f.apply('down', 60_000).status, 'unknown');
    assert.equal(count(f.db, 'incidents'), 0);
    assert.equal(f.apply('down').status, 'down');
    assert.equal(f.apply('unknown').status, 'unknown');
    assert.equal(f.apply('up').status, 'unknown');
    assert.equal(f.apply('up').status, 'operational');
    assert.equal(count(f.db, 'incidents'), 1);
  } finally { f.db.close(); }
});

test('maintenance keeps checks and incidents, defers outage mail until maintenance ends', () => {
  const f = fixture({ maintenance: true, maintenanceUntil: 125_000 });
  try {
    f.apply('down'); f.apply('down');
    assert.equal(count(f.db, 'checks'), 2); assert.equal(count(f.db, 'incidents'), 1); assert.equal(count(f.db, 'outbox'), 0);
    f.apply('down'); assert.equal(count(f.db, 'outbox'), 0);
    f.apply('down'); assert.equal(count(f.db, 'outbox'), 1);
    f.apply('up'); f.apply('up');
    assert.deepEqual(f.db.prepare('SELECT kind FROM outbox ORDER BY created_at').all(), [{ kind: 'down' }, { kind: 'up' }]);
  } finally { f.db.close(); }
});

test('an outage entirely inside maintenance produces no mail', () => {
  const f = fixture({ maintenance: true });
  try {
    f.apply('down'); f.apply('down'); f.apply('up'); f.apply('up');
    assert.equal(count(f.db, 'incidents'), 1); assert.equal(count(f.db, 'outbox'), 0);
    assert.ok((f.db.prepare('SELECT resolved_at FROM incidents').get() as { resolved_at: number }).resolved_at);
  } finally { f.db.close(); }
});

test('claims prevent duplicate probes and reject results for edited or expired configurations', () => {
  const f = fixture();
  try {
    const [claim] = claimMonitors(f.db, 100_000);
    assert.equal(claimMonitors(f.db, 100_000).length, 0);
    saveMonitor(f.db, { ...f.input, target: 'https://new.example.com' }, 'monitor', 100_001);
    const result: CheckResult = { outcome: 'up', latencyMs: 2, message: 'normal' };
    assert.equal(recordCheck(f.db, claim, result, 100_002), false);
    const [nextClaim] = claimMonitors(f.db, 100_002);
    assert.equal(recordCheck(f.db, nextClaim, result, nextClaim.leaseUntil + 1), false);
    const [replacement] = claimMonitors(f.db, nextClaim.leaseUntil + 1);
    assert.equal(recordCheck(f.db, nextClaim, result, nextClaim.leaseUntil + 2), false);
    assert.equal(recordCheck(f.db, replacement, result, nextClaim.leaseUntil + 2), true);
  } finally { f.db.close(); }
});

test('outbox retries have delay, a five-attempt limit and exclusive leases', () => {
  const db = openDatabase(':memory:');
  try {
    const id = enqueueMail(db, 'test', null, { subject: 'test', text: 'test' }, 1000);
    let now = 1000;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = claimMail(db, now)!;
      assert.equal(claim.id, id); assert.equal(claim.attempts, attempt); assert.equal(claimMail(db, now), undefined);
      completeMail(db, claim, 'SMTP failure', now);
      const row = db.prepare('SELECT status,next_attempt_at FROM outbox WHERE id=?').get(id) as { status: string; next_attempt_at: number };
      assert.equal(row.status, attempt === 5 ? 'failed' : 'pending');
      assert.equal(claimMail(db, now), undefined);
      now = row.next_attempt_at;
    }
    assert.equal(claimMail(db, now), undefined);
  } finally { db.close(); }
});

test('SMTP dispatch uses an injected sender, hides sensitive failures and marks successful delivery', async () => {
  const db = openDatabase(':memory:');
  try {
    setSetting(db, 'smtp', { ...defaultSmtp, enabled: true, password: 'private-password' });
    enqueueMail(db, 'test', null, { subject: 'test', text: 'message' }, 1000);
    await dispatchMail(db, { now: () => 1000, sender: async () => { throw new Error('private-password'); } });
    const failed = db.prepare('SELECT status,last_error FROM outbox').get() as { status: string; last_error: string };
    assert.equal(failed.status, 'pending'); assert.equal(failed.last_error.includes('private-password'), false);
    let sent = false;
    await dispatchMail(db, { now: () => 31_000, sender: async (smtp, payload) => {
      assert.equal(smtp.password, 'private-password'); assert.equal(payload.text, 'message'); sent = true;
    } });
    assert.equal(sent, true); assert.equal((db.prepare('SELECT status FROM outbox').get() as { status: string }).status, 'sent');
  } finally { db.close(); }
});

test('scheduler bounds concurrency and stop cancels active probes before returning', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let i = 0; i < 6; i++) saveMonitor(db, { ...defaultMonitor, name: `server ${i}`, target: 'https://example.com' }, String(i), 1000);
    let active = 0;
    const worker = createWorker(db, { concurrency: 2, now: () => 1000, probe: async (_monitor, signal) => {
      active++;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { active--; resolve(); }, { once: true }));
      return { outcome: 'unknown', latencyMs: null, message: 'cancelled' };
    } });
    const tick = worker.checkTick();
    assert.equal(active, 2);
    await worker.checkTick(); assert.equal(active, 2);
    await worker.stop(); await tick;
    assert.equal(active, 0); assert.equal(count(db, 'checks'), 2);
  } finally { db.close(); }
});

test('retention keeps at least 30 days and preserves open incidents', () => {
  const f = fixture();
  try {
    f.apply('down'); f.apply('down');
    pruneHistory(f.db, f.time + 29 * 86_400_000, 1);
    assert.equal(count(f.db, 'checks'), 2);
    pruneHistory(f.db, f.time + 31 * 86_400_000, 1);
    assert.equal(count(f.db, 'checks'), 0); assert.equal(count(f.db, 'incidents'), 1);
  } finally { f.db.close(); }
});


test('delayed outage retries keep subsequent recovery mail in chronological order', () => {
  const f = fixture();
  try {
    const outage = enqueueMail(f.db, 'down', 'monitor', { subject: 'down', text: 'down' }, 1000);
    const downClaim = claimMail(f.db, 1000)!;
    completeMail(f.db, downClaim, 'temporary SMTP failure', 1000);
    const recovery = enqueueMail(f.db, 'up', 'monitor', { subject: 'up', text: 'up' }, 1001);
    assert.equal(claimMail(f.db, 1001), undefined);
    // Independent test mail can still be sent while a monitor waits for its retry.
    const testId = enqueueMail(f.db, 'test', null, { subject: 'test', text: 'test' }, 1002);
    const testClaim = claimMail(f.db, 1002)!;
    assert.equal(testClaim.id, testId); completeMail(f.db, testClaim, null, 1002);
    const retried = claimMail(f.db, 31_000)!;
    assert.equal(retried.id, outage);
    assert.equal(claimMail(f.db, 31_000), undefined);
    completeMail(f.db, retried, null, 31_000);
    assert.equal(claimMail(f.db, 31_000)!.id, recovery);
  } finally { f.db.close(); }
});

test('maintenance, pause and probe edits cancel sending mail without retry resurrection', () => {
  for (const change of [{ maintenance: true }, { enabled: false }, { target: 'https://changed.example.com' }]) {
    const f = fixture({ failureThreshold: 1 });
    try {
      f.apply('down');
      const claim = claimMail(f.db, f.time)!;
      assert.ok(claim);
      saveMonitor(f.db, { ...f.input, ...change }, 'monitor', f.time + 1);
      completeMail(f.db, claim, 'interrupted SMTP delivery', f.time + 2);
      const row = f.db.prepare('SELECT status FROM outbox WHERE id=?').get(claim.id) as { status: string };
      assert.equal(row.status, 'cancelled');
      assert.equal(claimMail(f.db, f.time + 60_000), undefined);
    } finally { f.db.close(); }
  }
});


test('a slow probe does not hold an already available concurrency slot', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let i = 0; i < 3; i++) saveMonitor(db, { ...defaultMonitor, name: String(i), target: 'https://example.com' }, String(i), 1000);
    const seen: string[] = [];
    const worker = createWorker(db, { concurrency: 2, now: () => 1000, probe: async (monitor, signal) => {
      seen.push(monitor.id);
      if (monitor.id === '0') await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { outcome: 'up', latencyMs: 2, message: 'normal' };
    } });
    const firstTick = worker.checkTick();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ['0', '1']);
    await worker.checkTick();
    assert.deepEqual(seen, ['0', '1', '2']);
    assert.equal(count(db, 'checks'), 2);
    await worker.stop(); await firstTick;
    assert.equal(count(db, 'checks'), 3);
  } finally { db.close(); }
});
