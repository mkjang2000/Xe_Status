import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function key() {
  const value = process.env.ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) throw new Error('ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decrypt(value: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Invalid encrypted configuration.');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
}
