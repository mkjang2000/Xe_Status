import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHistory } from '../server/availability.js';
import { displayStatus } from '../server/status.js';
import { defaultMonitor } from '../shared/defaults.js';
import type { MonitorRecord } from '../shared/types.js';

const now = Date.parse('2026-10-01T03:00:00.000Z');
test('availability excludes missing observations and clips overlapping intervals', () => {
  const history = calculateHistory([
    { checkedAt: now - 180_000, intervalSeconds: 60, outcome: 'up' },
    { checkedAt: now - 150_000, intervalSeconds: 60, outcome: 'down' },
    { checkedAt: now - 60_000, intervalSeconds: 60, outcome: 'unknown' }
  ], now);
  assert.equal(history.length, 30);
  assert.equal(history.at(-1)?.date, '2026-10-01');
  assert.equal(history.at(-1)?.status, 'down');
  assert.ok(Math.abs(history.at(-1)!.uptime! - 100 / 3) < 0.001);
  assert.equal(history[0].uptime, null);
});

test('coverage crossing Korean midnight is split into the correct days', () => {
  const midnight = Date.parse('2026-09-30T15:00:00.000Z');
  const history = calculateHistory([
    { checkedAt: midnight - 30_000, intervalSeconds: 60, outcome: 'up' },
    { checkedAt: midnight + 30_000, intervalSeconds: 60, outcome: 'down' }
  ], midnight + 60_000);
  assert.equal(history.at(-2)?.date, '2026-09-30');
  assert.equal(history.at(-2)?.uptime, 100);
  assert.equal(history.at(-1)?.date, '2026-10-01');
  assert.equal(history.at(-1)?.uptime, 50);
});

test('unknown result immediately ends prior coverage; old results do not fill gaps', () => {
  const history = calculateHistory([
    { checkedAt: now - 86_400_000, intervalSeconds: 60, outcome: 'up' },
    { checkedAt: now - 60_000, intervalSeconds: 60, outcome: 'up' },
    { checkedAt: now - 40_000, intervalSeconds: 60, outcome: 'unknown' },
    { checkedAt: now - 20_000, intervalSeconds: 60, outcome: 'down' }
  ], now);
  assert.equal(history.at(-1)?.uptime, 50);
  assert.equal(calculateHistory([], now).every(day => day.status === 'unknown' && day.uptime === null), true);
});

test('stale and disabled monitors are unknown; maintenance expires automatically', () => {
  const monitor: MonitorRecord = { ...defaultMonitor, id: 'one', name: 'API', target: 'https://example.com',
    status: 'operational', failures: 0, successes: 2, lastCheckAt: now - 1000, nextCheckAt: now,
    leaseUntil: 0, revision: 1 };
  assert.equal(displayStatus(monitor, now), 'operational');
  assert.equal(displayStatus({ ...monitor, lastCheckAt: now - 76_000 }, now), 'unknown');
  assert.equal(displayStatus({ ...monitor, enabled: false, maintenance: true }, now), 'unknown');
  assert.equal(displayStatus({ ...monitor, maintenance: true }, now), 'maintenance');
  assert.equal(displayStatus({ ...monitor, maintenance: true, maintenanceUntil: now - 1 }, now), 'operational');
});
