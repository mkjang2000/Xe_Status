import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getMonitor, getMonitors, saveMonitor, type Db } from './db.js';
import { parseInput } from './validation.js';

export function registerMonitorManagement(app: FastifyInstance, db: Db, invalidate: () => void): void {
  app.post<{ Params: { id: string } }>('/api/admin/monitors/:id/move', async (request, reply) => {
    const { direction } = parseInput(z.object({ direction: z.enum(['up', 'down']) }).strict(), request.body);
    const moved = db.transaction(() => {
      const monitor = getMonitor(db, request.params.id);
      if (!monitor) return false;
      const ordered = getMonitors(db).filter(m => Boolean(m.archived) === Boolean(monitor.archived));
      const index = ordered.findIndex(m => m.id === monitor.id);
      const target = index + (direction === 'up' ? -1 : 1);
      if (target >= 0 && target < ordered.length) [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      ordered.forEach((m, sortOrder) => { if (m.sortOrder !== sortOrder) saveMonitor(db, { ...m, sortOrder }, m.id); });
      return true;
    }).immediate();
    if (!moved) return reply.code(404).send({ error: '모니터를 찾을 수 없습니다.' });
    invalidate(); return { ok: true };
  });
  app.post('/api/admin/monitors/bulk' , async (request, reply) => {
    const input = parseInput(z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(100),
      action: z.enum(['enable', 'disable', 'archive', 'restore', 'group', 'maintenance', 'maintenance-end']),
      group: z.string().trim().max(100).optional(), until: z.number().int().positive().max(8640000000000000).nullable().optional()
    }).strict(), request.body);
    const result = db.transaction(() => {
      const monitors = [...new Set(input.ids)].map(id => getMonitor(db, id));
      if (monitors.some(m => !m)) return 404;
      if (input.action === 'enable' && monitors.some(m => m?.archived)) return 409;
      for (const monitor of monitors) {
        if (!monitor) continue;
        const change = input.action === 'enable' ? { enabled: true } : input.action === 'disable' ? { enabled: false }
          : input.action === 'archive' ? { archived: true, enabled: false } : input.action === 'restore' ? { archived: false, enabled: false }
          : input.action === 'group' ? { group: input.group ?? '' }
          : input.action === 'maintenance' ? { maintenance: true, maintenanceUntil: input.until ?? null }
          : { maintenance: false, maintenanceUntil: null };
        saveMonitor(db, { ...monitor, ...change }, monitor.id);
      }
      return 200;
    }).immediate();
    if (result !== 200) return reply.code(result).send({ error: result === 404 ? '존재하지 않는 모니터가 포함되어 있습니다.' : '보관된 모니터는 먼저 복원하세요.' });
    invalidate(); return { ok: true };
  });
}
