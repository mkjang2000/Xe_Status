import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { openDatabase, saveMonitor, setSetting } from '../server/db.js';
import { defaultBranding, defaultMonitor, defaultSmtp } from '../shared/defaults.js';

process.env.ADMIN_PASSWORD = 'test-password-at-least-twelve';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
const mutationHeaders = { origin: 'http://localhost:5173', 'content-type': 'application/json' };
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const db = openDatabase(':memory:');
  const app = await buildApp(db);
  t.after(async () => { await app.close(); db.close(); });
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: mutationHeaders,
    payload: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(response.statusCode, 200);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  return { app, db, cookie, headers: { ...mutationHeaders, cookie } };
}

test('admin routes require a session; mutations require the configured origin', async t => {
  const { app, db, cookie, headers } = await setup(t);
  assert.equal((await app.inject('/api/admin/monitors')).statusCode, 401);
  assert.deepEqual((await app.inject('/api/auth/session')).json(), { authenticated: false });
  assert.deepEqual((await app.inject({ url: '/api/auth/session', headers: { cookie } })).json(), { authenticated: true });
  const row = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
  assert.notEqual(row.token_hash, cookie.split('=')[1]);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/branding', headers: { ...headers, origin: 'https://unrelated.example' }, payload: defaultBranding })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/admin/monitors', headers: { cookie } })).statusCode, 401);
});

test('monitor CRUD validates inputs and public response contains no private diagnostics', async t => {
  const { app, db, headers } = await setup(t);
  const input = { ...defaultMonitor, name: 'API', target: 'https://example.com/private-health',
    headers: { Authorization: 'Bearer private-test-token' } };
  const create = await app.inject({ method: 'POST', url: '/api/admin/monitors', headers, payload: input });
  assert.equal(create.statusCode, 201);
  const monitor = create.json();
  const now = Date.now();
  db.prepare("UPDATE monitors SET status='down',last_check_at=? WHERE id=?").run(now - 1000, monitor.id);
  db.prepare('INSERT INTO checks(monitor_id,checked_at,outcome,latency_ms,message,interval_seconds) VALUES (?,?,?,?,?,?)')
    .run(monitor.id, now - 60_000, 'down', null, 'private check reason', 60);
  db.prepare('INSERT INTO incidents(id,monitor_id,monitor_name,started_at,reason) VALUES (?,?,?,?,?)')
    .run('incident', monitor.id, monitor.name, now - 60_000, 'private incident reason');
  const result = await app.inject('/api/status');
  assert.equal(result.statusCode, 200);
  const status = result.json();
  assert.equal(status.overall, 'down');
  assert.equal(status.monitors[0].history.length, 30);
  assert.equal(status.monitors[0].history.at(-1).uptime, 0);
  for (const privateValue of ['private-health', 'private-test-token', 'private check reason', 'private incident reason']) assert.equal(result.body.includes(privateValue), false);
  assert.equal((await app.inject({ url: `/api/admin/monitors/${monitor.id}/checks`, headers })).json()[0].message, 'private check reason');
  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/monitors/${monitor.id}`, headers, payload: { ...input, timeoutSeconds: 60, intervalSeconds: 15 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/monitors', headers, payload: { ...input, kind: 'json', rules: [] } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/monitors/${monitor.id}`, headers, payload: { ...input, name: 'Renamed API', maintenance: true } })).statusCode, 200);
  assert.equal((await app.inject('/api/status')).json().overall, 'maintenance');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/monitors/${monitor.id}`, headers, payload: {} })).statusCode, 204);
  assert.deepEqual((await app.inject('/api/status')).json().monitors, []);
  assert.equal((db.prepare('SELECT count(*) AS count FROM checks').get() as { count: number }).count, 0);
});

test('SMTP masks and preserves its password and queues a test without sending', async t => {
  const { app, db, headers } = await setup(t);
  const settings = { ...defaultSmtp, enabled: true, host: 'smtp.example.com', username: 'user',
    password: 'smtp-private-value', from: 'status@example.com', recipients: ['admin@example.com'] };
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/smtp', headers, payload: defaultSmtp })).statusCode, 200);
  const saved = await app.inject({ method: 'PUT', url: '/api/admin/smtp', headers, payload: settings });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().passwordSet, true);
  assert.equal(saved.body.includes(settings.password), false);
  assert.equal(saved.json().password, undefined);
  const again = await app.inject({ method: 'PUT', url: '/api/admin/smtp', headers, payload: { ...settings, password: '' } });
  assert.equal(again.json().passwordSet, true);
  const encrypted = (db.prepare("SELECT value FROM settings WHERE key='smtp'").get() as { value: string }).value;
  assert.equal(encrypted.includes(settings.password), false);
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/smtp/test', headers, payload: {} })).statusCode, 202);
  const row = db.prepare('SELECT kind,status,payload FROM outbox').get() as { kind: string; status: string; payload: string };
  assert.equal(row.kind, 'test');
  assert.equal(row.status, 'pending');
  assert.ok(JSON.parse(row.payload).text);
});

test('branding validation and worker absence keep an empty installation honest', async t => {
  const { app, headers } = await setup(t);
  assert.equal((await app.inject('/api/status')).json().overall, 'unknown');
  assert.equal((await app.inject({ url: '/api/admin/health', headers })).json().lastTick, null);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/branding', headers, payload: { ...defaultBranding, title: 'My Status', brandColor: '#112233' } })).statusCode, 200);
  assert.equal((await app.inject('/api/status')).json().branding.title, 'My Status');
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/branding', headers, payload: { ...defaultBranding, brandColor: 'invalid-color' } })).statusCode, 400);
});

test('login attempts are rate limited', async t => {
  const { app } = await setup(t);
  for (let index = 0; index < 7; index++) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: mutationHeaders, payload: { password: 'wrong-password' } })).statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: mutationHeaders, payload: { password: 'wrong-password' } })).statusCode, 429);
});

test('changing the administrator password invalidates previous sessions', async t => {
  const { db, cookie } = await setup(t);
  const old = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'different-password-long-enough';
  const app = await buildApp(db);
  process.env.ADMIN_PASSWORD = old;
  try { assert.equal((await app.inject({ url: '/api/admin/monitors', headers: { cookie } })).statusCode, 401); }
  finally { await app.close(); }
});

test('maintenance does not remove failed observations from uptime', async t => {
  const { app, db } = await setup(t);
  const now = Date.now();
  const monitor = saveMonitor(db, { ...defaultMonitor, name: 'Site', target: 'https://example.com', maintenance: true });
  db.prepare('INSERT INTO checks(monitor_id,checked_at,outcome,latency_ms,message,interval_seconds) VALUES (?,?,?,?,?,?)')
    .run(monitor.id, now - 60_000, 'down', null, 'Unreachable', 60);
  setSetting(db, 'branding', defaultBranding);
  const status = (await app.inject('/api/status')).json();
  assert.equal(status.monitors[0].status, 'maintenance');
  assert.equal(status.monitors[0].history.at(-1).uptime, 0);
});


test('monitor creation rejects unsupported Unicode header values before persistence', async t => {
  const { app, db, headers } = await setup(t);
  const input = { ...defaultMonitor, name: 'Region API', target: 'https://example.com/health',
    headers: { 'X-Region': '서울' } };
  const invalid = await app.inject({ method: 'POST', url: '/api/admin/monitors', headers, payload: input });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, 'HTTP 헤더 값에 지원하지 않는 문자가 포함되어 있습니다.');
  assert.equal((db.prepare('SELECT count(*) AS count FROM monitors').get() as { count: number }).count, 0);
  const valid = await app.inject({ method: 'POST', url: '/api/admin/monitors', headers,
    payload: { ...input, headers: { 'X-Region': 'seoul' } } });
  assert.equal(valid.statusCode, 201);
});


test('development allows the configured origin and same-port loopback origins only', async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  const previousMode = process.env.NODE_ENV;
  process.env.APP_ORIGIN = 'http://status.example:5173';
  process.env.NODE_ENV = 'development';
  const db = openDatabase(':memory:');
  const app = await buildApp(db);
  try {
    for (const origin of ['http://status.example:5173', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { password: process.env.ADMIN_PASSWORD } });
      assert.equal(login.statusCode, 200, origin);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const save = await app.inject({ method: 'PUT', url: '/api/admin/branding', headers: { origin, cookie }, payload: defaultBranding });
      assert.equal(save.statusCode, 200, origin);
    }
    for (const origin of ['http://localhost:5174', 'https://unrelated.example']) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { password: process.env.ADMIN_PASSWORD } });
      assert.equal(response.statusCode, 403);
    }
  } finally { await app.close(); db.close(); process.env.APP_ORIGIN = previousOrigin; process.env.NODE_ENV = previousMode; }
});

test('production continues to require exactly the configured origin', async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  const previousMode = process.env.NODE_ENV;
  process.env.APP_ORIGIN = 'https://status.example';
  process.env.NODE_ENV = 'production';
  const db = openDatabase(':memory:');
  const app = await buildApp(db);
  try {
    const accepted = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://status.example' }, payload: { password: process.env.ADMIN_PASSWORD } });
    assert.equal(accepted.statusCode, 200);
    const rejected = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://localhost' }, payload: { password: process.env.ADMIN_PASSWORD } });
    assert.equal(rejected.statusCode, 403);
  } finally { await app.close(); db.close(); process.env.APP_ORIGIN = previousOrigin; process.env.NODE_ENV = previousMode; }
});
