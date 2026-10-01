export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15000),
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  }); } catch (cause) {
    const timedOut = cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name);
    throw new ApiError(timedOut ? '서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.', 0);
  }
  if (!response.ok) {
    let message = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    try { message = (await response.json()).error || message; } catch { /* Preserve the fallback for proxy errors. */ }
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
