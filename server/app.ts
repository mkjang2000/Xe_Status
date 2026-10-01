import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from './db.js';
import type { PublicStatus } from '../shared/types.js';
import { registerAuth } from './auth.js';
import { registerAdmin } from './admin.js';
import { publicStatus } from './status.js';

export function readConfiguration(): { password: string; origin: string } {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.length > 1024) throw new Error('ADMIN_PASSWORD must contain between 12 and 1024 characters.');
  if (!/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY ?? '')) throw new Error('ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  const configuredOrigin = process.env.APP_ORIGIN || 'http://localhost:5173';
  let origin: string;
  try {
    const parsed = new URL(configuredOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
    origin = parsed.origin;
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw new Error();
  } catch { throw new Error('APP_ORIGIN must be an HTTP origin, using HTTPS in production.'); }
  return { password, origin };
}

export async function buildApp(db: Db, options: { logger?: boolean } = {}) {
  const { password, origin } = readConfiguration();
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.cookie', 'req.headers.authorization'], serializers: {
    req: request => ({ method: request.method, url: request.url?.split('?')[0], hostname: request.hostname, remoteAddress: request.ip })
  } } : false, bodyLimit: 65_536, requestTimeout: 15_000 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
  app.setErrorHandler((error, _request, reply) => {
    const rawStatus = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
    const safeDetail = error && typeof error === 'object' && 'publicMessage' in error && typeof error.publicMessage === 'string' ? error.publicMessage : null;
    const message = status === 429 ? '요청이 많습니다. 잠시 후 다시 시도하세요.' : status < 500 ? safeDetail || '입력값 또는 요청 형식을 확인하세요.' : '요청을 처리하지 못했습니다.';
    if (status >= 500) app.log.error({ code: 'REQUEST_FAILED' }, 'Request failed');
    void reply.code(status).send({ error: message });
  });
  const allowedOrigins = new Set([origin]);
  if (process.env.NODE_ENV === 'development') {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const local = new URL(origin);
      local.hostname = hostname;
      allowedOrigins.add(local.origin);
    }
  }
  registerAuth(app, db, password, allowedOrigins);
  let cached: PublicStatus | null = null;
  let cachedAt = 0;
  app.get('/api/status', async () => {
    const now = Date.now();
    if (!cached || now - cachedAt >= 5000) { cached = publicStatus(db, now); cachedAt = now; }
    return cached;
  });
  registerAdmin(app, db, () => { cached = null; });
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/') && existsSync(resolve(dist, 'index.html')) && request.headers.accept?.includes('text/html')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: '페이지를 찾을 수 없습니다.' });
  });
  return app;
}
