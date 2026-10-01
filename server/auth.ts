import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { hashPassword, readPasswordRecord, sessionKey, verifyPassword } from './passwords.js';

const COOKIE = 'xe_session';
const SESSION_SECONDS = 12 * 60 * 60;

export function registerAuth(app: FastifyInstance, db: Db, password: string, allowedOrigins: ReadonlySet<string>): void {
  const tokenHash = (token: string, record = readPasswordRecord(db)) => createHmac('sha256', sessionKey(password, record)).update(token).digest('hex');
  const authenticated = (request: FastifyRequest): boolean => {
    const token = request.cookies[COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    return Boolean(db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token), Date.now()));
  };
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.routeOptions.url ?? request.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (!allowedOrigins.has(request.headers.origin ?? '')) return reply.code(403).send({ error: '허용되지 않은 요청입니다.' });
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return reply.code(415).send({ error: 'JSON 형식으로 요청하세요.' });
    }
    if ((pathname === '/api/admin' || pathname.startsWith('/api/admin/')) && !authenticated(request)) {
      return reply.code(401).send({ error: '로그인이 필요합니다.' });
    }
  });
  app.get('/api/auth/session', async request => ({ authenticated: authenticated(request) }));
  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as { password?: unknown } | null;
    const supplied = body && typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
    const record = readPasswordRecord(db);
    if (!supplied || !await verifyPassword(supplied, password, record)) return reply.code(401).send({ error: '비밀번호를 확인하세요.' });
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    const accepted = db.transaction(() => {
      if (readPasswordRecord(db) !== record) return false;
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
      const previous = request.cookies[COOKIE];
      if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(previous));
      db.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES (?,?)').run(tokenHash(token, record), now + SESSION_SECONDS * 1000);
      return true;
    }).immediate();
    if (!accepted) return reply.code(401).send({ error: '비밀번호가 변경되었습니다. 다시 로그인하세요.' });
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS });
    return { authenticated: true };
  });
  app.post('/api/admin/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown } | null;
    if (!body || typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 1024 ||
      typeof body.newPassword !== 'string' || body.newPassword.length < 12 || body.newPassword.length > 1024) {
      return reply.code(400).send({ error: '현재 비밀번호와 12~1024자의 새 비밀번호를 입력하세요.' });
    }
    if (body.newPassword !== body.confirmPassword) return reply.code(400).send({ error: '새 비밀번호와 확인 값이 일치하지 않습니다.' });
    if (body.newPassword === body.currentPassword) return reply.code(400).send({ error: '기존과 다른 새 비밀번호를 입력하세요.' });
    const record = readPasswordRecord(db);
    if (!await verifyPassword(body.currentPassword, password, record)) return reply.code(400).send({ error: '현재 비밀번호가 올바르지 않습니다.' });
    const replacement = await hashPassword(body.newPassword);
    const changed = db.transaction(() => {
      if (readPasswordRecord(db) !== record || !authenticated(request)) return false;
      db.prepare("INSERT INTO settings(key,value) VALUES('admin_password',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(replacement);
      db.prepare('DELETE FROM sessions').run();
      return true;
    }).immediate();
    if (!changed) return reply.code(409).send({ error: '로그인 상태가 변경되었습니다. 다시 로그인하세요.' });
    reply.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    return { changed: true };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    reply.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    return { authenticated: false };
  });
}
