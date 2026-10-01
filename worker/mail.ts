import nodemailer from 'nodemailer';
import { getSetting, type Db } from '../server/db.js';
import { defaultSmtp } from '../shared/defaults.js';
import type { SmtpSettings } from '../shared/types.js';
import type { MailPayload } from './state.js';

const MAX_ATTEMPTS = 5;
export interface MailClaim { id: string; payload: string; attempts: number; lease_until: number }
export type MailSender = (smtp: SmtpSettings, payload: MailPayload, signal: AbortSignal) => Promise<void>;

export function claimMail(db: Db, now: number): MailClaim | undefined {
  return db.transaction(() => {
    db.prepare("UPDATE outbox SET status='failed',last_error='발송 시도 횟수를 초과했습니다.' WHERE status='sending' AND lease_until<=? AND attempts>=?")
      .run(now, MAX_ATTEMPTS);
    const row = db.prepare(`SELECT queued.id,queued.payload,queued.attempts,queued.lease_until FROM outbox AS queued
      WHERE ((queued.status='pending' AND queued.next_attempt_at<=?) OR (queued.status='sending' AND queued.lease_until<=?))
        AND queued.attempts<? AND NOT EXISTS (
          SELECT 1 FROM outbox AS previous WHERE previous.monitor_id=queued.monitor_id
            AND previous.rowid<queued.rowid AND previous.status IN ('pending','sending')
        )
      ORDER BY queued.created_at,queued.rowid LIMIT 1`).get(now, now, MAX_ATTEMPTS) as MailClaim | undefined;
    if (!row) return undefined;
    row.attempts += 1; row.lease_until = now + 60_000;
    db.prepare("UPDATE outbox SET status='sending',attempts=?,lease_until=? WHERE id=?").run(row.attempts, row.lease_until, row.id);
    return row;
  }).immediate();
}

export function completeMail(db: Db, claim: MailClaim, error: string | null, now: number): void {
  const status = error ? claim.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' : 'sent';
  const retryAt = now + Math.min(3_600_000, 30_000 * 2 ** (claim.attempts - 1));
  db.prepare("UPDATE outbox SET status=?,last_error=?,next_attempt_at=?,lease_until=0 WHERE id=? AND status='sending' AND lease_until=?")
    .run(status, error, retryAt, claim.id, claim.lease_until);
}

export const sendSmtpMail: MailSender = async (smtp, payload, signal) => {
  signal.throwIfAborted();
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.security === 'tls', requireTLS: smtp.security === 'starttls',
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    tls: { rejectUnauthorized: true }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    disableFileAccess: true, disableUrlAccess: true
  });
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      transport.sendMail({ from: smtp.from, to: smtp.recipients, subject: payload.subject, text: payload.text }),
      new Promise<never>((_, reject) => {
        abort = () => { transport.close(); reject(new Error('SMTP aborted')); };
        signal.addEventListener('abort', abort, { once: true });
      })
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    transport.close();
  }
};

export async function dispatchMail(db: Db, options: { sender?: MailSender; now?: () => number; signal?: AbortSignal } = {}): Promise<boolean> {
  const now = options.now ?? Date.now;
  const smtp = getSetting(db, 'smtp', defaultSmtp);
  if (!smtp.enabled || options.signal?.aborted) return false;
  const claim = claimMail(db, now());
  if (!claim) return false;
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const payload = JSON.parse(claim.payload) as MailPayload;
    if (typeof payload.subject !== 'string' || typeof payload.text !== 'string') throw new Error('Invalid payload');
    await (options.sender ?? sendSmtpMail)(smtp, payload, signal);
    completeMail(db, claim, null, now());
  } catch {
    completeMail(db, claim, signal.aborted ? '메일 발송 제한 시간 초과 또는 워커 종료' : 'SMTP 메일 발송 실패: 연결, 인증, 수신 설정을 확인하세요.', now());
  }
  return true;
}
