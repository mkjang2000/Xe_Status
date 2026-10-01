import { test, expect } from '@playwright/test';
import { defaultBranding, defaultMonitor, defaultSmtp } from '../../shared/defaults.js';

const origin = 'http://127.0.0.1:5174';
test.beforeEach(async ({ request }) => {
  await request.post('/api/auth/login', { headers: { origin }, data: { password: 'local-browser-test-password' } });
  const monitors = await (await request.get('/api/admin/monitors')).json() as { id: string }[];
  for (const monitor of monitors) await request.delete(`/api/admin/monitors/${monitor.id}`, { headers: { origin }, data: {} });
  await request.put('/api/admin/branding', { headers: { origin }, data: defaultBranding });
  await request.put('/api/admin/smtp', { headers: { origin }, data: defaultSmtp });
  await request.post('/api/auth/logout', { headers: { origin }, data: {} });
});

test('public empty state and mobile layout contain no imaginary healthy services', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByText('아직 등록된 서비스가 없습니다')).toBeVisible();
  await expect(page.getByText('서비스 등록을 기다리고 있습니다')).toBeVisible();
  await page.screenshot({ path: info.outputPath('public-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('public-mobile.png'), fullPage: true });
});

test('administrator configures monitoring and changes the login password', async ({ page, request }, info) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/admin');
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('local-browser-test-password');
  await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('button', { name: '서비스 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('서비스 이름', { exact: true }).fill('브라우저 API');
  await dialog.getByRole('button', { name: /JSON API/ }).click();
  await dialog.getByLabel('검사 URL').fill('https://example.com/health');
  await dialog.getByRole('button', { name: '조건 추가' }).click();
  await dialog.getByLabel('조건 1 필드 경로').fill('database.connected');
  await dialog.getByLabel('조건 1 비교 값').fill('true');
  await dialog.getByRole('button', { name: '서비스 추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('브라우저 API', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '브라우저 API 수정', exact: true }).click();
  await dialog.getByLabel('점검 모드').check();
  await dialog.getByRole('button', { name: '변경 사항 저장' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('점검 중', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-monitors.png'), fullPage: true });

  await page.getByRole('button', { name: /디자인/ }).click();
  await page.getByLabel('페이지 이름', { exact: true }).fill('나의 서비스 상태');
  await page.getByLabel('브랜드 색상 색상 코드', { exact: true }).fill('#7c3aed');
  await page.getByRole('button', { name: '디자인 저장' }).click();
  await expect(page.getByText(/디자인 설정이 저장되었습니다/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-branding.png'), fullPage: true });

  await page.getByRole('button', { name: /메일 알림/ }).click();
  await page.getByLabel('SMTP 호스트', { exact: true }).fill('smtp.example.com');
  await page.getByLabel('발신 이메일', { exact: true }).fill('status@example.com');
  await page.getByLabel('수신 이메일').fill('owner@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('browser-test-smtp-secret');
  await page.getByRole('button', { name: '알림 설정 저장' }).click();
  await expect(page.getByText('메일 알림 설정을 저장했습니다.')).toBeVisible();
  await expect(page.getByLabel('비밀번호', { exact: false })).toHaveValue('');
  const smtp = await (await page.request.get('/api/admin/smtp')).json();
  expect(smtp.passwordSet).toBe(true);
  expect(smtp.password).toBeUndefined();

  await page.goto('/');
  await expect(page.getByRole('link', { name: '나의 서비스 상태 상태 페이지' })).toBeVisible();
  await expect(page.getByText('브라우저 API', { exact: true })).toBeVisible();
  await expect(page.getByLabel('브라우저 API 최근 30일 상태').locator('.history-bar')).toHaveCount(30);
  await page.screenshot({ path: info.outputPath('public-configured.png'), fullPage: true });
  await page.goto('/admin');
  await page.getByRole('button', { name: '비밀번호', exact: true }).click();
  await page.getByLabel('현재 비밀번호', { exact: true }).fill('local-browser-test-password');
  await page.getByLabel('새 비밀번호', { exact: false }).first().fill('my memorable browser phrase');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('my memorable browser phrase');
  await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click();
  try {
    await expect(page.getByText('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.', { exact: true })).toBeVisible();
    await page.getByLabel('관리자 비밀번호', { exact: true }).fill('my memorable browser phrase');
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '상태 페이지 관리' })).toBeVisible();
  } finally {
    await request.post('/api/auth/login', { headers: { origin }, data: { password: 'my memorable browser phrase' } });
    const restored = await request.post('/api/admin/password', { headers: { origin }, data: {
      currentPassword: 'my memorable browser phrase', newPassword: 'local-browser-test-password', confirmPassword: 'local-browser-test-password'
    } });
    expect(restored.status()).toBe(200);
  }
  expect(browserErrors).toEqual([]);
});

test('public fetch failure replaces the current summary with an explicit error', async ({ page, request }) => {
  await page.route('**/api/status', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('상태 정보를 불러오지 못했습니다.');
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
});


test('public service states, daily history and incident timeline render at desktop and mobile sizes', async ({ page }, info) => {
  const now = Date.now();
  const history = Array.from({ length: 30 }, (_, index) => ({
    date: new Date(now - (29 - index) * 86400000).toISOString().slice(0, 10),
    status: index < 3 ? 'unknown' : 'operational', uptime: index < 3 ? null : 100
  }));
  const fixture = {
    branding: defaultBranding, overall: 'down', updatedAt: now, lastCheckAt: now - 24000,
    monitors: [
      { id: 'web', name: '웹사이트', description: '메인 웹사이트', status: 'operational', lastCheckAt: now - 24000, history },
      { id: 'api', name: 'API 서버', description: '애플리케이션 API', status: 'operational', lastCheckAt: now - 24000, history },
      { id: 'storage', name: '파일 스토리지', description: '이미지 및 파일 서비스', status: 'down', lastCheckAt: now - 24000,
        history: history.map((day, index) => index === 29 ? { ...day, status: 'down', uptime: 97.1 } : day) }
    ],
    incidents: [
      { id: 'incident', monitorName: '파일 스토리지', startedAt: now - 17 * 60000, resolvedAt: null },
      { id: 'resolved', monitorName: 'API 서버', startedAt: now - 5 * 86400000, resolvedAt: now - 5 * 86400000 + 8 * 60000 }
    ]
  };
  await page.route('**/api/status', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await expect(page.getByText('일부 서비스에 문제가 있습니다')).toBeVisible();
  await expect(page.getByText('정상 운영', { exact: true })).toHaveCount(2);
  await expect(page.getByText('장애 진행 중', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('public-services-desktop.png'), fullPage: true });
  await page.getByLabel('파일 스토리지 최근 30일 상태').locator('.history-bar').last().hover();
  const tooltip = page.getByLabel('파일 스토리지 최근 30일 상태').locator('.history-bar').last().locator('.history-tooltip');
  await expect(tooltip).toContainText('가동률 97.10%');
  await expect(tooltip).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('public-services-mobile.png'), fullPage: true });
});
