export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...extra,
    },
  });
}

export function assertOrigin(request, origin) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('origin') !== origin) {
    throw new HttpError(403, 'ORIGIN_REJECTED', 'This request must come from the administration page.');
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed.');
  }
}

export async function readJSON(request, maxBytes = 256 * 1024) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large.');
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'The request contains invalid JSON.'); }
}

export function cookiesAfterResponse(request, response) {
  const cookies = new Map();
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0];
    const index = first.indexOf('=');
    if (index > 0) cookies.set(first.slice(0, index), first.slice(index + 1));
  }
  const headers = new Headers(request.headers);
  headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  return headers;
}
