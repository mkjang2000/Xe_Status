import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const digest = (value: string) => createHash('sha256').update(value).digest();
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, PARAMETERS, (error, key) => error ? reject(error) : resolve(key));
});

export function readPasswordRecord(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function sessionKey(initialPassword: string, record: string | null): Buffer {
  return digest(record ?? initialPassword);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return JSON.stringify({ version: 1, salt, hash: key.toString('hex') });
}

export async function verifyPassword(password: string, initialPassword: string, record: string | null): Promise<boolean> {
  if (record === null) return timingSafeEqual(digest(password), digest(initialPassword));
  const saved = JSON.parse(record) as { version: number; salt: string; hash: string };
  if (saved.version !== 1 || !/^[a-f0-9]{32}$/.test(saved.salt) || !/^[a-f0-9]{128}$/.test(saved.hash)) {
    throw new Error('Invalid password record.');
  }
  return timingSafeEqual(await derive(password, saved.salt), Buffer.from(saved.hash, 'hex'));
}
