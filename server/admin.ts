import { registerIncidents } from './incidents.js';
import { registerMonitorManagement } from './monitor-management.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { defaultBranding, defaultSmtp } from '../shared/defaults.js';
import type { DeliveryRecord, SmtpSettings, SmtpView } from '../shared/types.js';
import { getChecks, getMonitor, getMonitors, getSetting, saveMonitor, setSetting, type Db } from './db.js';
import { asAdminMonitor } from './status.js';
import { brandingSchema, monitorSchema, parseInput, smtpSchema } from './validation.js';

function smtpView(settings: SmtpSettings): SmtpView {
  const { password, ...publicFields } = settings;
  return { ...publicFields, passwordSet: Boolean(password) };
}
export function registerAdmin(app: FastifyInstance, db: Db, invalidateStatus: () => void): void {
  registerIncidents(app, db, invalidateStatus);
  registerMonitorManagement(app, db, invalidateStatus);
  app.get('/api/admin/monitors', async () => getMonitors(db).map(monitor => asAdminMonitor(db, monitor)));
  app.post('/api/admin/monitors', async (request, reply) => {
    const { count } = db.prepare('SELECT count(*) AS count FROM monitors').get() as { count: number };
    if (count >= 100) return reply.code(400).send({ error: '모니터는 최대 100개까지 등록할 수 있습니다.' });
    const monitor = saveMonitor(db, parseInput(monitorSchema, request.body));
    invalidateStatus();
    return reply.code(201).send(asAdminMonitor(db, monitor));
  });
  app.put<{ Params: { id: string } }>('/api/admin/monitors/:id', async (request, reply) => {
    if (!getMonitor(db, request.params.id)) return reply.code(404).send({ error: '모니터를 찾을 수 없습니다.' });
    const monitor = saveMonitor(db, parseInput(monitorSchema, request.body), request.params.id);
    invalidateStatus();
    return asAdminMonitor(db, monitor);
  });
  app.delete<{ Params: { id: string } }>('/api/admin/monitors/:id', async (request, reply) => {
    const result = db.prepare('DELETE FROM monitors WHERE id=?').run(request.params.id);
    if (!result.changes) return reply.code(404).send({ error: '모니터를 찾을 수 없습니다.' });
    invalidateStatus();
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/admin/monitors/:id/checks', async (request, reply) => {
    if (!getMonitor(db, request.params.id)) return reply.code(404).send({ error: '모니터를 찾을 수 없습니다.' });
    return getChecks(db, request.params.id, 100);
  });
  app.get('/api/admin/branding', async () => getSetting(db, 'branding', defaultBranding));
  app.put('/api/admin/branding', async request => {
    const branding = parseInput(brandingSchema, request.body);
    setSetting(db, 'branding', branding);
    invalidateStatus();
    return branding;
  });
  app.get('/api/admin/smtp', async () => smtpView(getSetting(db, 'smtp', defaultSmtp)));
  app.put('/api/admin/smtp', async request => {
    const parsed = parseInput(smtpSchema, request.body);
    const previous = getSetting(db, 'smtp', defaultSmtp);
    const settings: SmtpSettings = { ...parsed, password: parsed.password || previous.password };
    setSetting(db, 'smtp', settings);
    return smtpView(settings);
  });
  app.post('/api/admin/smtp/test', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (_request, reply) => {
    const settings = getSetting(db, 'smtp', defaultSmtp);
    if (!settings.enabled || !settings.host || !settings.from || !settings.recipients.length) {
      return reply.code(400).send({ error: 'SMTP 설정을 저장하고 활성화하세요.' });
    }
    const id = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO outbox(id,kind,payload,next_attempt_at,created_at) VALUES (?,?,?,?,?)')
      .run(id, 'test', JSON.stringify({ subject: 'XE Status 테스트 메일', text: 'SMTP 연결 테스트 메일입니다. 이 메일을 받았다면 알림을 수신할 수 있습니다.' }), now, now);
    return reply.code(202).send({ id, message: '테스트 메일을 발송 대기열에 등록했습니다.' });
  });
  app.get('/api/admin/deliveries', async () => db.prepare(`SELECT id, kind, status, attempts,
    last_error AS lastError, created_at AS createdAt FROM outbox ORDER BY created_at DESC LIMIT 50`).all() as DeliveryRecord[]);
  app.get('/api/admin/health', async () => {
    const state = db.prepare('SELECT last_tick AS lastTick FROM worker_state WHERE id=1').get() as { lastTick: number } | undefined;
    return state ?? { lastTick: null };
  });
}
