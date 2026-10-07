import type { CheckOutcome, DailyHistory } from '../shared/types.js';

const DAY = 86_400_000;
const KST_OFFSET = 9 * 60 * 60 * 1000;
export interface AvailabilitySample { checkedAt: number; outcome: CheckOutcome; intervalSeconds: number }
export function historyStart(now: number): number {
  return Math.floor((now + KST_OFFSET) / DAY) * DAY - KST_OFFSET - 29 * DAY;
}

/** Samples cover only their scheduled interval; the following sample cuts coverage short. */
export function calculateHistory(samples: Iterable<AvailabilitySample>, now: number, exclusions: { startedAt: number; endedAt: number }[] = []): DailyHistory[] {
  const start = historyStart(now);
  const ranges: { startedAt: number; endedAt: number }[] = [];
  for (const range of [...exclusions].sort((a, b) => a.startedAt - b.startedAt)) {
    const last = ranges.at(-1);
    if (last && range.startedAt <= last.endedAt) last.endedAt = Math.max(last.endedAt, range.endedAt);
    else if (range.endedAt > range.startedAt) ranges.push({ ...range });
  }
  const buckets = Array.from({ length: 30 }, (_, index) => ({
    date: new Date(start + index * DAY + KST_OFFSET).toISOString().slice(0, 10), up: 0, down: 0
  }));
  const add = (sample: AvailabilitySample, nextAt: number) => {
    if (sample.outcome === 'unknown') return;
    let cursor = Math.max(start, sample.checkedAt);
    const end = Math.min(now, nextAt, sample.checkedAt + sample.intervalSeconds * 1000);
    while (cursor < end) {
      const index = Math.floor((cursor - start) / DAY);
      if (index < 0 || index >= buckets.length) break;
      const until = Math.min(end, start + (index + 1) * DAY);
      let measured = until - cursor;
      for (const range of ranges) {
        if (range.startedAt >= until) break;
        measured -= Math.max(0, Math.min(until, range.endedAt) - Math.max(cursor, range.startedAt));
      }
      buckets[index][sample.outcome] += measured;
      cursor = until;
    }
  };
  let previous: AvailabilitySample | undefined;
  for (const sample of samples) {
    if (previous) add(previous, sample.checkedAt);
    previous = sample;
  }
  if (previous) add(previous, now);
  return buckets.map(({ date, up, down }) => ({ date,
    status: down > 0 ? 'down' : up > 0 ? 'operational' : 'unknown',
    uptime: up + down > 0 ? up / (up + down) * 100 : null
  }));
}
