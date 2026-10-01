import { z } from 'zod';
import { validateHeaderValue } from 'node:http';
import { defaultMonitor } from '../shared/defaults.js';
import { validatePublicTarget } from '../worker/network.js';

const trimmed = (max: number) => z.string().trim().max(max);
const webLink = trimmed(2048).refine(value => !value || (() => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
})(), 'HTTP 또는 HTTPS 주소를 입력하세요.');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rule = z.object({
  path: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/),
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists']),
  value: z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]).optional()
}).strict().superRefine((value, ctx) => {
  if (value.operator !== 'exists' && value.value === undefined) ctx.addIssue({ code: 'custom', message: '비교 값을 입력하세요.' });
  if (['gt', 'gte', 'lt', 'lte'].includes(value.operator) && typeof value.value !== 'number') ctx.addIssue({ code: 'custom', message: '숫자 비교에는 숫자 값이 필요합니다.' });
});
const blockedHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate']);
const headers = z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/), z.string().max(4096).regex(/^[^\r\n\x00-\x1f\x7f]*$/))
  .refine(value => Object.keys(value).length <= 20 && Object.keys(value).every(key => !blockedHeaders.has(key.toLowerCase())), '허용되지 않는 HTTP 헤더입니다.')
  .refine(value => {
    try {
      for (const [name, content] of Object.entries(value)) validateHeaderValue(name, content);
      return true;
    } catch { return false; }
  }, 'HTTP 헤더 값에 지원하지 않는 문자가 포함되어 있습니다.');

export const monitorSchema = z.object({
  name: trimmed(100).min(1), description: trimmed(500).default(''), kind: z.enum(['ping', 'http', 'json']),
  target: trimmed(2048).min(1), intervalSeconds: z.number().int().min(15).max(3600).default(defaultMonitor.intervalSeconds),
  timeoutSeconds: z.number().int().min(1).max(60).default(defaultMonitor.timeoutSeconds),
  failureThreshold: z.number().int().min(1).max(10).default(3), recoveryThreshold: z.number().int().min(1).max(10).default(2),
  enabled: z.boolean().default(true), maintenance: z.boolean().default(false),
  maintenanceUntil: z.number().int().positive().max(8_640_000_000_000_000).nullable().default(null),
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'), headers: headers.default({}), body: z.string().max(16_384).default(''),
  expectedStatus: z.number().int().min(100).max(599).default(200), rules: z.array(rule).max(20).default([]),
  sortOrder: z.number().int().min(-1000).max(1000).default(0)
}).strict().superRefine((value, ctx) => {
  if (!validatePublicTarget(value.target, value.kind)) ctx.addIssue({ code: 'custom', path: ['target'], message: '공개 인터넷의 유효한 주소를 입력하세요.' });
  if (value.timeoutSeconds >= value.intervalSeconds) ctx.addIssue({ code: 'custom', path: ['timeoutSeconds'], message: '제한 시간은 검사 주기보다 짧아야 합니다.' });
  if (value.kind === 'json' && (value.rules.length === 0 || value.method === 'HEAD')) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'JSON 검사는 GET 또는 POST와 하나 이상의 조건이 필요합니다.' });
  if (value.method !== 'POST' && value.body) ctx.addIssue({ code: 'custom', path: ['body'], message: '요청 본문은 POST에서만 사용할 수 있습니다.' });
});

export const brandingSchema = z.object({
  title: trimmed(80).min(1), description: trimmed(300), logoUrl: webLink, faviconUrl: webLink, websiteUrl: webLink,
  brandColor: color, backgroundColor: color, operationalColor: color, downColor: color, maintenanceColor: color
}).strict();

export const smtpSchema = z.object({
  enabled: z.boolean(), host: trimmed(253), port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls']), username: z.string().max(254), password: z.string().max(1024).optional(),
  from: trimmed(254), recipients: z.array(trimmed(254).pipe(z.email())).max(20)
}).strict().superRefine((value, ctx) => {
  if (value.host && !validatePublicTarget(value.host, 'ping')) ctx.addIssue({ code: 'custom', path: ['host'], message: '유효한 공개 SMTP 호스트를 입력하세요.' });
  if (value.from && !z.email().safeParse(value.from).success) ctx.addIssue({ code: 'custom', path: ['from'], message: '발신 이메일 주소를 확인하세요.' });
  if (value.enabled && (!value.host || !value.from || !value.recipients.length)) ctx.addIssue({ code: 'custom', message: 'SMTP 호스트, 발신자와 수신자가 필요합니다.' });
});

export function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues.find(issue => issue.code === 'custom')?.message || '입력값의 형식과 허용 범위를 확인하세요.';
    throw Object.assign(new Error('Invalid configuration.'), { statusCode: 400, publicMessage: detail });
  }
  return result.data;
}
