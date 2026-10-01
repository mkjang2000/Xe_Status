import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, saveMonitor, getMonitor, getSetting, setSetting, getChecks } from '../server/db.js';
import { encrypt, decrypt } from '../server/secrets.js';
import { defaultMonitor, defaultSmtp } from '../shared/defaults.js';

process.env.ENCRYPTION_KEY = '19'.repeat(32);

test('monitor and SMTP credentials are encrypted at rest and round-trip', () => {
  const db = openDatabase(':memory:');
  try {
    const monitor = saveMonitor(db, { ...defaultMonitor, name: 'API', target: 'https://example.com/health', headers: { Authorization: 'Bearer private-test-value' } });
    const raw = db.prepare('SELECT config FROM monitors WHERE id=?').get(monitor.id) as { config: string };
    assert.equal(raw.config.includes('private-test-value'), false);
    assert.equal(getMonitor(db, monitor.id)?.headers.Authorization, 'Bearer private-test-value');
    setSetting(db, 'smtp', { ...defaultSmtp, password: 'smtp-private-test-value' });
    const smtp = db.prepare("SELECT value FROM settings WHERE key='smtp'").get() as { value: string };
    assert.equal(smtp.value.includes('smtp-private-test-value'), false);
    assert.equal(getSetting(db, 'smtp', defaultSmtp).password, 'smtp-private-test-value');
  } finally { db.close(); }
});

test('pausing invalidates an in-flight result, resets state and ends measured coverage', () => {
  const db = openDatabase(':memory:');
  try {
    const initial = saveMonitor(db, { ...defaultMonitor, name: 'API', target: 'https://example.com' }, 'api', 1000);
    db.prepare("UPDATE monitors SET status='operational', last_check_at=1000, lease_until=30000 WHERE id=?").run(initial.id);
    db.prepare("INSERT INTO incidents(id,monitor_id,monitor_name,started_at) VALUES('paused-incident','api','API',1000)").run();
    const paused = saveMonitor(db, { ...defaultMonitor, name: 'API', target: 'https://example.com', enabled: false }, initial.id, 2000);
    assert.equal(paused.revision, initial.revision + 1);
    assert.equal(paused.status, 'unknown');
    assert.equal(paused.leaseUntil, 0);
    assert.equal(paused.lastCheckAt, null);
    assert.equal(getChecks(db, initial.id)[0].outcome, 'unknown');
    assert.equal(getChecks(db, initial.id)[0].checkedAt, 2000);
    const incident = db.prepare("SELECT resolution_cause FROM incidents WHERE id='paused-incident'").get() as { resolution_cause: string };
    assert.equal(incident.resolution_cause, 'configuration');
  } finally { db.close(); }
});

test('entering maintenance cancels queued transition mail without erasing results', () => {
  const db = openDatabase(':memory:');
  try {
    const input = { ...defaultMonitor, name: 'API', target: 'https://example.com' };
    saveMonitor(db, input, 'api', 1000);
    db.prepare("UPDATE monitors SET status='down', last_check_at=1000 WHERE id='api'").run();
    db.prepare("INSERT INTO incidents(id,monitor_id,monitor_name,started_at,notification_sent) VALUES('incident','api','API',1000,1)").run();
    db.prepare("INSERT INTO outbox(id,monitor_id,kind,payload,created_at) VALUES('mail','api','down','{}',1000)").run();
    const updated = saveMonitor(db, { ...input, maintenance: true }, 'api', 2000);
    assert.equal(updated.status, 'down');
    assert.equal(updated.lastCheckAt, 1000);
    const row = db.prepare("SELECT status FROM outbox WHERE id='mail'").get() as {status: string};
    assert.equal(row.status, 'cancelled');
  } finally { db.close(); }
});

test('encrypted values reject tampering and missing key', () => {
  const encoded = encrypt('hello');
  const parts = encoded.split('.');
  parts[3] = Buffer.from('altered').toString('base64');
  assert.throws(() => decrypt(parts.join('.')));
  const key = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try { assert.throws(() => encrypt('hello'), /ENCRYPTION_KEY/); }
  finally { process.env.ENCRYPTION_KEY = key; }
});
