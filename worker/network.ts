import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import type { MonitorKind } from '../shared/types.js';

export class ProbeError extends Error {}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress() || !ipv6.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3)) return false;
    }
    return parsed.range() === 'unicast';
  } catch { return false; }
}

function validHostname(hostname: string): boolean {
  if (!hostname || hostname.includes('%')) return false;
  if (ipaddr.isValid(hostname)) return isPublicAddress(hostname);
  const name = hostname.replace(/\.$/, '');
  if (name.length > 253 || !name.includes('.') || /^\d+(?:\.\d+)*$/.test(name)) return false;
  return name.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
}

export function parseHttpTarget(target: string): URL {
  let url: URL;
  try { url = new URL(target); } catch { throw new ProbeError('올바른 HTTP 주소가 아닙니다.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !validHostname(hostname)) {
    throw new ProbeError('공개 HTTP/HTTPS 주소만 검사할 수 있습니다.');
  }
  return url;
}

export function validatePublicTarget(target: string, kind: MonitorKind): boolean {
  if (target !== target.trim()) return false;
  try {
    if (kind !== 'ping') { parseHttpTarget(target); return true; }
    return validHostname(target);
  } catch { return false; }
}

export type AddressResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: AddressResolver = hostname => lookup(hostname, { all: true, verbatim: true });

export async function resolvePublicAddress(hostname: string, signal: AbortSignal, resolver = systemResolver) {
  const host = hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  if (!validHostname(host)) throw new ProbeError('공개 네트워크 주소만 검사할 수 있습니다.');
  if (ipaddr.isValid(host)) return { address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 };
  let onAbort: (() => void) | undefined;
  try {
    const addresses = await Promise.race([
      resolver(host),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      })
    ]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(result => !isPublicAddress(result.address))) {
      throw new ProbeError('DNS 응답에 허용되지 않은 네트워크 주소가 있습니다.');
    }
    return addresses[0];
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}
