import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

const initial = 'initial-password-for-test';
const replacement = 'remember this long phrase';
process.env.ADMIN_PASSWORD = initial;
process.env.ENCRYPTION_KEY = '67'.repeat(32);
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
const origin = process.env.APP_ORIGIN;

test('password change validates current password, invalidates every session and survives restart', async () => {
  const db = openDatabase(':memory:');
  let app = await buildApp(db);
  const login = async (password: string) => app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { password } });
  try {
    const one = await login(initial);
    const two = await login(initial);
    const cookie = String(one.headers['set-cookie']).split(';')[0];
    const otherCookie = String(two.headers['set-cookie']).split(';')[0];
    const headers = { origin, cookie };
    const payload = { currentPassword: initial, newPassword: replacement, confirmPassword: replacement };
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/password', headers: { origin }, payload })).statusCode, 401);
    const wrong = await app.inject({ method: 'POST', url: '/api/admin/password', headers, payload: { ...payload, currentPassword: 'incorrect-password' } });
    assert.equal(wrong.statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/password', headers, payload: { ...payload, confirmPassword: 'different' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/password', headers, payload: { ...payload, newPassword: 'short', confirmPassword: 'short' } })).statusCode, 400);
    assert.equal((db.prepare('SELECT count(*) AS count FROM sessions').get() as {count:number}).count, 2);
    const changed = await app.inject({ method: 'POST', url: '/api/admin/password', headers, payload });
    assert.equal(changed.statusCode, 200);
    const row = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get() as { value: string };
    assert.equal(row.value.includes(replacement), false);
    assert.equal(JSON.parse(row.value).hash.length, 128);
    for (const previous of [cookie, otherCookie]) {
      assert.equal((await app.inject({ url: '/api/admin/monitors', headers: { cookie: previous } })).statusCode, 401);
    }
    assert.equal((await login(initial)).statusCode, 401);
    assert.equal((await login(replacement)).statusCode, 200);
    assert.equal((await app.inject('/api/status')).body.includes('admin_password'), false);
    await app.close();
    app = await buildApp(db);
    assert.equal((await login(initial)).statusCode, 401);
    assert.equal((await login(replacement)).statusCode, 200);
  } finally { await app.close(); db.close(); }
});

test('simultaneous changes cannot replace a newly changed credential with an outdated request', async () => {
  const db = openDatabase(':memory:');
  const app = await buildApp(db);
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { password: initial } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const results = await Promise.all([replacement, 'another memorable phrase'].map(newPassword => app.inject({
      method: 'POST', url: '/api/admin/password', headers: { origin, cookie },
      payload: { currentPassword: initial, newPassword, confirmPassword: newPassword }
    })));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  } finally { await app.close(); db.close(); }
});
