import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { CheckResult, JsonRule, MonitorInput } from '../shared/types.js';
import { parseHttpTarget, ProbeError, resolvePublicAddress, type AddressResolver } from './network.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
type RequestFunction = typeof httpRequest;
export interface ProbeDependencies { resolver?: AddressResolver; request?: RequestFunction; ping?: typeof execFile; signal?: AbortSignal }

export function matchesJsonRules(value: unknown, rules: JsonRule[]): boolean {
  return rules.every(rule => {
    let current: unknown = value;
    let exists = true;
    for (const key of rule.path.split('.')) {
      if (!key || !current || typeof current !== 'object' || !Object.hasOwn(current, key)) {
        exists = false; break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (rule.operator === 'exists') return exists;
    if (!exists) return false;
    switch (rule.operator) {
      case 'eq': return current === rule.value;
      case 'ne': return current !== rule.value;
      case 'gt': return typeof current === 'number' && typeof rule.value === 'number' && current > rule.value;
      case 'gte': return typeof current === 'number' && typeof rule.value === 'number' && current >= rule.value;
      case 'lt': return typeof current === 'number' && typeof rule.value === 'number' && current < rule.value;
      case 'lte': return typeof current === 'number' && typeof rule.value === 'number' && current <= rule.value;
      default: return false;
    }
  });
}

async function fetchResponse(url: URL, monitor: MonitorInput, signal: AbortSignal, dependencies: ProbeDependencies,
  redirects = 0, method = monitor.method, body = monitor.body): Promise<{ status: number; body: string }> {
  const address = await resolvePublicAddress(url.hostname, signal, dependencies.resolver);
  const request = dependencies.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest);
  const headers = { ...monitor.headers };
  // A caller cannot replace the authority used for certificate verification and routing.
  for (const key of Object.keys(headers)) {
    if (['host', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) delete headers[key];
  }
  if (body && method !== 'HEAD') headers['Content-Length'] = String(Buffer.byteLength(body));
  const options: RequestOptions = {
    method, headers, signal, agent: false, family: address.family,
    lookup: (_hostname, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    }
  };
  return new Promise((resolve, reject) => {
    const req = request(url, options, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy();
        try {
          if (redirects >= 3) throw new ProbeError('HTTP 리디렉션 횟수를 초과했습니다.');
          const next = parseHttpTarget(new URL(response.headers.location, url).href);
          if (next.origin !== url.origin) throw new ProbeError('다른 출처로의 리디렉션은 지원하지 않습니다.');
          const switchToGet = status === 303 && method !== 'HEAD' || [301, 302].includes(status) && method === 'POST';
          resolve(fetchResponse(next, monitor, signal, dependencies, redirects + 1, switchToGet ? 'GET' : method, switchToGet ? '' : body));
        } catch (error) { reject(error); }
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          const error = new ProbeError('HTTP 응답 크기가 1MB 제한을 초과했습니다.');
          response.destroy(error); reject(error);
        } else chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('aborted', () => reject(new ProbeError('HTTP 응답이 완료되기 전에 연결이 끊겼습니다.')));
      response.once('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    if (body && method !== 'HEAD') req.write(body);
    req.end();
  });
}

async function ping(monitor: MonitorInput, signal: AbortSignal, dependencies: ProbeDependencies): Promise<void> {
  const address = await resolvePublicAddress(monitor.target, signal, dependencies.resolver);
  const execute = dependencies.ping ?? execFile;
  await new Promise<void>((resolve, reject) => {
    execute('ping', [address.family === 6 ? '-6' : '-4', '-n', '-c', '1', '-W', String(monitor.timeoutSeconds), '--', address.address],
      { signal, timeout: monitor.timeoutSeconds * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 }, (error, _stdout, stderr) => {
        if (error && /operation not permitted|permission denied|socket:.*not permitted/i.test(String(stderr))) {
          reject(Object.assign(new Error('Ping unavailable'), { code: 'EPERM' }));
        } else if (error) reject(error);
        else resolve();
      });
  });
}

export async function runProbe(monitor: MonitorInput, dependencies: ProbeDependencies = {}): Promise<CheckResult> {
  const started = performance.now();
  const controller = new AbortController();
  const signal = dependencies.signal ? AbortSignal.any([controller.signal, dependencies.signal]) : controller.signal;
  const timeout = Math.max(1, Math.min(60, monitor.timeoutSeconds)) * 1000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (monitor.kind === 'ping') await ping(monitor, signal, dependencies);
    else {
      const response = await fetchResponse(parseHttpTarget(monitor.target), monitor, signal, dependencies);
      if (response.status !== monitor.expectedStatus) throw new ProbeError(`HTTP 상태 코드 불일치 (응답 ${response.status})`);
      if (monitor.kind === 'json') {
        let body: unknown;
        try { body = JSON.parse(response.body); } catch { throw new ProbeError('응답이 올바른 JSON 형식이 아닙니다.'); }
        if (!matchesJsonRules(body, monitor.rules)) throw new ProbeError('JSON 필드 조건이 충족되지 않았습니다.');
      }
    }
    return { outcome: 'up', latencyMs: Math.round(performance.now() - started), message: '정상 응답' };
  } catch (error) {
    if (dependencies.signal?.aborted) return { outcome: 'unknown', latencyMs: null, message: '워커 종료로 검사가 중단되었습니다.' };
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (monitor.kind === 'ping' && ['ENOENT', 'EACCES', 'EPERM'].includes(String(code))) {
      return { outcome: 'unknown', latencyMs: null, message: 'Ping 도구를 실행할 수 없습니다. 설치와 실행 권한을 확인하세요.' };
    }
    const message = controller.signal.aborted ? '검사 제한 시간을 초과했습니다.'
      : error instanceof ProbeError ? error.message : '대상 연결 또는 응답 확인에 실패했습니다.';
    return { outcome: 'down', latencyMs: Math.round(performance.now() - started), message };
  } finally { clearTimeout(timer); }
}
