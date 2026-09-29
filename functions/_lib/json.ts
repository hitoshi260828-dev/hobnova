export function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 管理API/問い合わせ内容はキャッシュさせない。
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error, ...extra }, status);
}
