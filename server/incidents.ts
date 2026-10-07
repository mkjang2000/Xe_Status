import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AdminIncident, IncidentCorrection } from '../shared/types.js';
import { getMonitor, getSetting, type Db } from './db.js';
import { parseInput } from './validation.js';

const pagination = { page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const querySchema = z.object({ ...pagination, monitorId: z.string().max(100).optional(),
  from: z.coerce.number().int().nonnegative().optional(), to: z.coerce.number().int().nonnegative().optional(),
  state: z.enum(['all', 'open', 'resolved', 'corrected']).default('all') }).refine(q => q.from === undefined || q.to === undefined || q.from <= q.to, '기간을 확인하세요.');
const columns = `i.id, i.monitor_id AS monitorId, i.monitor_name AS monitorName, i.started_at AS startedAt,
  i.resolved_at AS resolvedAt, i.resolution_cause AS resolutionCause, i.reason,
  (SELECT count(*) FROM incident_corrections c WHERE c.incident_id=i.id AND c.revoked_at IS NULL) AS corrected`;
export function corrections(db: Db, incidentId: string): IncidentCorrection[] {
  return db.prepare(`SELECT id, started_at AS startedAt, ended_at AS endedAt, reason, created_at AS createdAt,
    revoked_at AS revokedAt, revoke_reason AS revokeReason FROM incident_corrections WHERE incident_id=? ORDER BY created_at,id`).all(incidentId) as IncidentCorrection[];
}
export function exclusions(db: Db, monitorId: string, from = 0, to = Number.MAX_SAFE_INTEGER): { startedAt: number; endedAt: number }[] {
  return db.prepare(`SELECT started_at AS startedAt, ended_at AS endedAt FROM incident_corrections
    WHERE monitor_id=? AND revoked_at IS NULL AND ended_at>? AND started_at<? ORDER BY started_at`).all(monitorId, from, to) as { startedAt: number; endedAt: number }[];
}
export function fullyCorrected(db: Db, incidentId: string, start: number, end: number): boolean {
  let cursor = start;
  for (const range of corrections(db, incidentId).filter(c => c.revokedAt === null).sort((a, b) => a.startedAt - b.startedAt)) {
    if (range.startedAt > cursor) break;
    cursor = Math.max(cursor, range.endedAt);
  }
  return cursor > start && cursor >= end;
}
export function registerIncidents(app: FastifyInstance, db: Db, invalidate: () => void): void {
  app.get<{ Params: { id: string } }>('/api/admin/monitors/:id/check-history', async (request, reply) => {
    const q = parseInput(querySchema, request.query);
    if (!getMonitor(db, request.params.id)) return reply.code(404).send({ error: '모니터를 찾을 수 없습니다.' });
    const args = [request.params.id, q.from ?? 0, q.to ?? Date.now()];
    const clause = 'monitor_id=? AND checked_at>=? AND checked_at<=?';
    const total = (db.prepare(`SELECT count(*) AS n FROM checks WHERE ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`SELECT id, monitor_id AS monitorId, checked_at AS checkedAt, outcome, latency_ms AS latencyMs,
      message, interval_seconds AS intervalSeconds FROM checks WHERE ${clause} ORDER BY checked_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize, retentionCutoff: getSetting<number | null>(db, 'checks_retention_cutoff', null) };
  });
  app.get('/api/admin/incidents', async request => {
    const q = parseInput(querySchema, request.query);
    const where = ['1=1']; const values: (string | number)[] = [];
    if (q.monitorId) { where.push('i.monitor_id=?'); values.push(q.monitorId); }
    if (q.from !== undefined) { where.push('(i.resolved_at IS NULL OR i.resolved_at>=?)'); values.push(q.from); }
    if (q.to !== undefined) { where.push('i.started_at<=?'); values.push(q.to); }
    if (q.state === 'open') where.push('i.resolved_at IS NULL');
    if (q.state === 'resolved') where.push('i.resolved_at IS NOT NULL');
    if (q.state === 'corrected') where.push('EXISTS(SELECT 1 FROM incident_corrections c WHERE c.incident_id=i.id AND c.revoked_at IS NULL)');
    const clause = where.join(' AND ');
    const total = (db.prepare(`SELECT count(*) AS n FROM incidents i WHERE ${clause}`).get(...values) as { n: number }).n;
    const items = db.prepare(`SELECT ${columns} FROM incidents i WHERE ${clause} ORDER BY i.started_at DESC,i.id DESC LIMIT ? OFFSET ?`).all(...values, q.pageSize, (q.page - 1) * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
  app.get<{ Params: { id: string } }>('/api/admin/incidents/:id', async (request, reply) => {
    const q = parseInput(z.object(pagination), request.query);
    const incident = db.prepare(`SELECT ${columns} FROM incidents i WHERE i.id=?`).get(request.params.id) as AdminIncident | undefined;
    if (!incident) return reply.code(404).send({ error: '장애 기록을 찾을 수 없습니다.' });
    const args = [incident.monitorId, incident.startedAt - 3600000, (incident.resolvedAt ?? Date.now()) + 3600000];
    const clause = 'monitor_id=? AND checked_at>=? AND checked_at<=?';
    const total = (db.prepare(`SELECT count(*) AS n FROM checks WHERE ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`SELECT id, monitor_id AS monitorId, checked_at AS checkedAt, outcome, latency_ms AS latencyMs,
      message, interval_seconds AS intervalSeconds FROM checks WHERE ${clause} ORDER BY checked_at,id LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    return { incident, corrections: corrections(db, incident.id), checks: { items, total, page: q.page, pageSize: q.pageSize }, retentionCutoff: getSetting<number | null>(db, 'checks_retention_cutoff', null) };
  });
  app.post<{ Params: { id: string } }>('/api/admin/incidents/:id/corrections', async (request, reply) => {
    const body = parseInput(z.object({ startedAt: z.number().int().nonnegative(), endedAt: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(1000) }).strict(), request.body);
    const result = db.transaction(() => {
      const incident = db.prepare(`SELECT ${columns} FROM incidents i WHERE i.id=?`).get(request.params.id) as AdminIncident | undefined;
      if (!incident) return 404;
      const now = Date.now();
      if (body.startedAt < incident.startedAt || body.endedAt > (incident.resolvedAt ?? now) || body.endedAt <= body.startedAt) return 400;
      db.prepare('INSERT INTO incident_corrections(id,incident_id,monitor_id,started_at,ended_at,reason,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), incident.id, incident.monitorId, body.startedAt, body.endedAt, body.reason, now);
      return 201;
    }).immediate();
    if (result !== 201) return reply.code(result).send({ error: result === 404 ? '장애 기록을 찾을 수 없습니다.' : '제외 구간은 장애 시작부터 복구 또는 현재 시각 사이여야 합니다.' });
    invalidate(); return reply.code(201).send({ ok: true });
  });
  app.post<{ Params: { id: string; correctionId: string } }>('/api/admin/incidents/:id/corrections/:correctionId/revoke', async (request, reply) => {
    const body = parseInput(z.object({ reason: z.string().trim().min(1).max(1000) }).strict(), request.body);
    const changed = db.prepare(`UPDATE incident_corrections SET revoked_at=?,revoke_reason=? WHERE id=? AND incident_id=? AND revoked_at IS NULL`)
      .run(Date.now(), body.reason, request.params.correctionId, request.params.id);
    if (!changed.changes) return reply.code(409).send({ error: '이미 취소되었거나 존재하지 않는 정정입니다.' });
    invalidate(); return { ok: true };
  });
}
