import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { defaultMonitor } from '../shared/defaults.js';
import { isPublicAddress, resolvePublicAddress, validatePublicTarget } from '../worker/network.js';
import { matchesJsonRules, runProbe, type ProbeDependencies } from '../worker/probes.js';

const resolver = async () => [{ address: '1.1.1.1', family: 4 }];
interface ResponseFixture { status?: number; body?: string | Buffer; location?: string; inspect?: (url: URL, options: RequestOptions) => void }
function requests(fixtures: ResponseFixture[]): NonNullable<ProbeDependencies['request']> {
  return ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const fixture = fixtures.shift();
    assert.ok(fixture, 'Unexpected request');
    fixture.inspect?.(url, options);
    const request = new EventEmitter() as EventEmitter & { write(): void; end(): void };
    request.write = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = fixture.status ?? 200;
      response.headers = fixture.location ? { location: fixture.location } : {};
      callback(response);
      (response as unknown as PassThrough).end(fixture.body ?? '');
    });
    return request;
  }) as unknown as NonNullable<ProbeDependencies['request']>;
}

test('JSON rules use exact types, own fields and dotted array paths', () => {
  const body = { status: 'ok', database: { connected: true }, pending: 12, entries: [{ ready: true }], nullable: null };
  assert.equal(matchesJsonRules(body, [
    { path: 'status', operator: 'eq', value: 'ok' }, { path: 'database.connected', operator: 'eq', value: true },
    { path: 'pending', operator: 'lt', value: 100 }, { path: 'entries.0.ready', operator: 'eq', value: true },
    { path: 'nullable', operator: 'exists' }
  ]), true);
  assert.equal(matchesJsonRules(body, [{ path: 'pending', operator: 'eq', value: '12' }]), false);
  assert.equal(matchesJsonRules(body, [{ path: 'missing', operator: 'ne', value: false }]), false);
  assert.equal(matchesJsonRules(body, [{ path: 'toString', operator: 'exists' }]), false);
  assert.equal(matchesJsonRules(body, [{ path: 'nullable.child', operator: 'exists' }]), false);
  assert.equal(matchesJsonRules({ pending: '12' }, [{ path: 'pending', operator: 'gt', value: 1 }]), false);
});

test('monitor targets reject local, reserved, mapped and credential-bearing URLs', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '::2', '::127.0.0.1', 'fec0::1', '224.0.0.1', '192.0.2.1', '::1', 'fe80::1', 'fc00::1', '::ffff:8.8.8.8', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  for (const target of ['http://2130706433/', 'http://0177.0.0.1/', 'http://localhost/', 'ftp://example.com/', 'https://user:password@example.com/']) {
    assert.equal(validatePublicTarget(target, 'http'), false, target);
  }
  assert.equal(validatePublicTarget('example.com;command', 'ping'), false);
  assert.equal(validatePublicTarget('https://example.com/health?token=private', 'json'), true);
});

test('DNS resolution rejects mixed public/private answers and respects cancellation', async () => {
  await assert.rejects(resolvePublicAddress('example.com', new AbortController().signal,
    async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]));
  const controller = new AbortController();
  const pending = resolvePublicAddress('example.com', controller.signal, () => new Promise(() => {}));
  controller.abort();
  await assert.rejects(pending);
});

test('HTTP connects through pinned DNS and validates status plus JSON contents', async () => {
  let lookupChecked = false;
  const result = await runProbe({ ...defaultMonitor, kind: 'json', target: 'https://example.com/health',
    headers: { Host: 'attacker.example', Authorization: 'Bearer private' },
    rules: [{ path: 'database.connected', operator: 'eq', value: true }] }, {
    resolver,
    request: requests([{ body: '{"database":{"connected":true}}', inspect: (url, options) => {
      assert.equal(url.hostname, 'example.com');
      assert.equal((options.headers as Record<string, string>).Host, undefined);
      assert.equal(options.agent, false);
      options.lookup!('example.com', {}, ((error: Error | null, address: string, family: number) => {
        assert.equal(error, null); assert.equal(address, '1.1.1.1'); assert.equal(family, 4); lookupChecked = true;
      }) as Parameters<NonNullable<RequestOptions['lookup']>>[2]);
    } }])
  });
  assert.equal(lookupChecked, true);
  assert.equal(result.outcome, 'up');
  assert.equal(result.message.includes('private'), false);
});

test('redirects stay same-origin and validate DNS again', async () => {
  const monitor = { ...defaultMonitor, target: 'https://example.com/start', headers: { Authorization: 'private-secret' } };
  const crossOrigin = await runProbe(monitor, { resolver, request: requests([{ status: 302, location: 'https://other.example/secret' }]) });
  assert.equal(crossOrigin.outcome, 'down');
  assert.match(crossOrigin.message, /리디렉션/);
  let calls = 0;
  const rebound = await runProbe(monitor, {
    resolver: async () => [{ address: ++calls === 1 ? '1.1.1.1' : '127.0.0.1', family: 4 }],
    request: requests([{ status: 302, location: '/next' }])
  });
  assert.equal(calls, 2); assert.equal(rebound.outcome, 'down');
  assert.equal(rebound.message.includes('private-secret'), false);
  const loop = await runProbe(monitor, { resolver, request: requests(Array.from({ length: 4 }, () => ({ status: 302, location: '/next' }))) });
  assert.match(loop.message, /횟수/);
});

test('HTTP failure, malformed JSON and oversized bodies fail with generic diagnostics', async () => {
  const monitor = { ...defaultMonitor, kind: 'json' as const, target: 'https://example.com/?password=private-secret' };
  const fixtures = [
    { status: 503, body: 'private-secret' }, { body: 'private-secret' }, { body: Buffer.alloc(1024 * 1024 + 1) }
  ];
  for (const fixture of fixtures) {
    const result = await runProbe(monitor, { resolver, request: requests([fixture]) });
    assert.equal(result.outcome, 'down');
    assert.equal(result.message.includes('private-secret'), false);
  }
});

test('DNS time is included in total timeout and worker cancellation is unknown', async () => {
  const monitor = { ...defaultMonitor, target: 'https://example.com', timeoutSeconds: 1 };
  const result = await runProbe(monitor, { resolver: () => new Promise(() => {}) });
  assert.equal(result.outcome, 'down'); assert.match(result.message, /시간/);
  const controller = new AbortController();
  const cancelled = runProbe(monitor, { signal: controller.signal, resolver: () => new Promise(() => {}) });
  controller.abort();
  assert.equal((await cancelled).outcome, 'unknown');
});

test('Ping uses a validated address as an argument and missing binaries are unknown', async () => {
  let argsSeen: string[] = [];
  const ping = ((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    assert.equal(file, 'ping'); argsSeen = args;
    callback(Object.assign(new Error('private internal details'), { code: 'ENOENT' }), '', '');
    return {} as ChildProcess;
  }) as NonNullable<ProbeDependencies['ping']>;
  const result = await runProbe({ ...defaultMonitor, kind: 'ping', target: 'example.com' }, { resolver, ping });
  assert.equal(argsSeen.at(-1), '1.1.1.1'); assert.equal(result.outcome, 'unknown');
  assert.equal(result.message.includes('private'), false);
});
