import { openDatabase } from '../server/db.js';
import { encrypt } from '../server/secrets.js';
import { createWorker } from './scheduler.js';

encrypt('startup configuration validation');
const db = openDatabase();
const configuredRetention = Number(process.env.RETENTION_DAYS || 90);
const worker = createWorker(db, {
  retentionDays: Number.isFinite(configuredRetention) ? Math.max(30, configuredRetention) : 90,
  onError: message => console.error(message)
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  db.close();
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
worker.start();
console.info('XE Status 검사 워커를 시작했습니다.');
