import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { publicStatus } from '../server/status.js';
import { createWorker } from '../worker/scheduler.js';
import { defaultMonitor, defaultSmtp } from '../shared/defaults.js';
import type { AdminMonitor, CheckResult } from '../shared/types.js';

test('API configuration, shared SQLite worker, incidents and mocked SMTP form one flow', async () => {
  process.env.ADMIN_PASSWORD = 'integration-only-password';
  process.env.ENCRYPTION_KEY = '37'.repeat(32);
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.NODE_ENV = 'test';
  const directory = mkdtempSync(join(tmpdir(), 'xe-status-integration-'));
  const apiDb = openDatabase(join(directory, 'status.db'));
  const workerDb = openDatabase(join(directory, 'status.db'));
  const app = await buildApp(apiDb);
  let now = Date.now();
  let result: CheckResult = { outcome: 'up', latencyMs: 20, message: '정상 응답' };
  const delivered: string[] = [];
  const worker = createWorker(workerDb, {
    now: () => now, probe: async () => result,
    sender: async (_smtp, payload) => { delivered.push(payload.subject); }
  });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: process.env.APP_ORIGIN }, payload: { password: process.env.ADMIN_PASSWORD } });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ');
    const headers = { cookie, origin: process.env.APP_ORIGIN };
    const smtp = await app.inject({ method: 'PUT', url: '/api/admin/smtp', headers, payload: {
      ...defaultSmtp, enabled: true, host: 'smtp.example.com', from: 'status@example.com', recipients: ['owner@example.com'], password: 'never-sent-credential'
    } });
    assert.equal(smtp.statusCode, 200);
    const config = { ...defaultMonitor, name: '통합 API', target: 'https://example.com/health', headers: { Authorization: 'Bearer never-public' } };
    const created = await app.inject({ method: 'POST', url: '/api/admin/monitors', headers, payload: config });
    assert.equal(created.statusCode, 201);
    const monitor = created.json<AdminMonitor>();
    now = Date.now() + 10;
    const tick = async () => { await worker.checkTick(); now += 60_001; };
    await tick();
    assert.equal(publicStatus(apiDb, now - 1).monitors[0].status, 'operational');
    result = { outcome: 'down', latencyMs: 1000, message: '제한 시간 초과' };
    await tick(); await tick(); await tick();
    let status = publicStatus(apiDb, now - 1);
    assert.equal(status.overall, 'down');
    assert.equal(status.incidents.length, 1);
    await worker.mailTick();
    assert.equal(delivered.length, 1);
    assert.match(delivered[0], /장애 발생/);
    await tick(); await worker.mailTick();
    assert.equal(delivered.length, 1, 'ongoing failure must not generate duplicate notices');
    const edited = await app.inject({ method: 'PUT', url: `/api/admin/monitors/${monitor.id}`, headers,
      payload: { ...config, maintenance: true } });
    assert.equal(edited.statusCode, 200);
    await tick(); await worker.mailTick();
    assert.equal(publicStatus(apiDb, now - 1).overall, 'maintenance');
    assert.equal(delivered.length, 1);
    await app.inject({ method: 'PUT', url: `/api/admin/monitors/${monitor.id}`, headers, payload: config });
    await tick(); await worker.mailTick();
    assert.equal(delivered.length, 2, 'still-down service alerts after maintenance ends');
    result = { outcome: 'up', latencyMs: 18, message: '정상 응답' };
    await tick();
    assert.equal(publicStatus(apiDb, now - 1).overall, 'down');
    await tick(); await worker.mailTick();
    status = publicStatus(apiDb, now - 1);
    assert.equal(status.overall, 'operational');
    assert.ok(status.incidents[0].resolvedAt);
    assert.equal(delivered.length, 3);
    assert.match(delivered[2], /정상 복구/);
    assert.equal(JSON.stringify(status).includes('never-public'), false);
    assert.equal(JSON.stringify(status).includes('example.com/health'), false);
    assert.ok(status.monitors[0].history.some(day => day.uptime !== null && day.uptime < 100));
  } finally {
    await worker.stop(); await app.close(); workerDb.close(); apiDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
