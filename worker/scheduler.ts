import type { Db } from '../server/db.js';
import type { CheckResult, MonitorRecord } from '../shared/types.js';
import { dispatchMail, type MailSender } from './mail.js';
import { runProbe } from './probes.js';
import { claimMonitors, heartbeat, pruneHistory, recordCheck } from './state.js';

interface WorkerOptions {
  concurrency?: number;
  retentionDays?: number;
  now?: () => number;
  probe?: (monitor: MonitorRecord, signal: AbortSignal) => Promise<CheckResult>;
  sender?: MailSender;
  onError?: (message: string) => void;
}

/** A bounded probe pool and one independent SMTP dispatcher share the scheduler. */
export function createWorker(db: Db, options: WorkerOptions = {}) {
  const controller = new AbortController();
  const now = options.now ?? Date.now;
  const probe = options.probe ?? ((monitor, signal) => runProbe(monitor, { signal }));
  const concurrency = Math.max(1, Math.min(10, Math.floor(options.concurrency ?? 5)));
  const activeChecks = new Set<Promise<void>>();
  let mailWork: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastPrune = 0;

  async function checkTick() {
    if (controller.signal.aborted) return;
    const launched: Promise<void>[] = [];
    try {
      heartbeat(db, now());
      if (now() - lastPrune > 3_600_000) { pruneHistory(db, now(), options.retentionDays); lastPrune = now(); }
      const slots = concurrency - activeChecks.size;
      if (slots <= 0) return;
      // Claims and pool registration are synchronous, so concurrent ticks cannot overfill the pool.
      for (const monitor of claimMonitors(db, now(), slots)) {
        const probeWork = (async () => {
          let result: CheckResult;
          try { result = await probe(monitor, controller.signal); }
          catch { result = { outcome: 'unknown', latencyMs: null, message: '검사 워커가 결과를 확인하지 못했습니다.' }; }
          recordCheck(db, monitor, result, now());
        })();
        const settled = probeWork.catch(() => {
          options.onError?.('검사 결과 저장에 실패했습니다. 데이터베이스 상태를 확인하세요.');
        }).finally(() => activeChecks.delete(settled));
        activeChecks.add(settled);
        launched.push(settled);
      }
    } catch { options.onError?.('검사 작업을 준비하지 못했습니다. 데이터베이스 상태를 확인하세요.'); }
    await Promise.allSettled(launched);
  }

  async function mailTick() {
    if (controller.signal.aborted || mailWork) return;
    mailWork = (async () => { await dispatchMail(db, { sender: options.sender, now, signal: controller.signal }); })();
    try { await mailWork; } catch { options.onError?.('메일 작업 처리에 실패했습니다. 데이터베이스 상태를 확인하세요.'); }
    finally { mailWork = undefined; }
  }

  return {
    checkTick, mailTick,
    start() {
      if (timer || controller.signal.aborted) return;
      void checkTick(); void mailTick();
      timer = setInterval(() => { void checkTick(); void mailTick(); }, 1000);
    },
    async stop() {
      if (timer) clearInterval(timer);
      controller.abort();
      await Promise.allSettled([...activeChecks, mailWork].filter(Boolean));
    }
  };
}
