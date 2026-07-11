export const PAGE_SOURCE = 'xbi-page';
export const EXT_SOURCE = 'xbi-extension';

const SAFE_HEADER_KEYS = new Set([
  'x-client-transaction-id',
  'x-twitter-client-language',
]);
const SAFE_PARAM_KEYS = new Set(['features', 'fieldToggles', 'variables']);
const SAFE_BODY_KEYS = new Set(['features', 'fieldToggles', 'queryId', 'variables']);
const BLOCKED_DATA_KEYS = new Set([
  '__proto__',
  'authorization',
  'bearer',
  'constructor',
  'cookie',
  'csrf',
  'prototype',
  'set-cookie',
  'x-csrf-token',
]);
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function plainHeaders(input = {}) {
  try {
    const entries = typeof Headers !== 'undefined' && input instanceof Headers
      ? input.entries()
      : Array.isArray(input)
        ? input
        : Object.entries(input ?? {});
    const headers = {};
    for (const [rawKey, rawValue] of entries) {
      headers[String(rawKey).toLowerCase()] = String(rawValue);
    }
    return headers;
  } catch {
    return {};
  }
}

function sanitizeJsonValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth >= 20 || seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry, seen, depth + 1))
      .filter((entry) => entry !== undefined);
  }

  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_DATA_KEYS.has(key.toLowerCase())) continue;
    const safeEntry = sanitizeJsonValue(entry, seen, depth + 1);
    if (safeEntry !== undefined) sanitized[key] = safeEntry;
  }
  return sanitized;
}

function sanitizeParams(input) {
  const params = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (SAFE_PARAM_KEYS.has(key) && typeof value === 'string') params[key] = value;
  }
  return params;
}

function sanitizeBody(rawBody) {
  let body = rawBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const sanitized = {};
  for (const [key, value] of Object.entries(body)) {
    if (!SAFE_BODY_KEYS.has(key)) continue;
    const safeValue = sanitizeJsonValue(value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
}

function sanitizeOperationHeaders(input) {
  const headers = plainHeaders(input);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_HEADER_KEYS.has(key)),
  );
}

function sanitizeOperationTemplate(input = {}) {
  const method = String(input.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  return {
    method,
    params: sanitizeParams(input.params),
    body: sanitizeBody(input.body),
  };
}

export function sanitizeCapture(capture) {
  if (!capture || typeof capture !== 'object') return null;
  if (!OPERATION_PATTERN.test(capture.operation) || !QUERY_ID_PATTERN.test(capture.queryId)) return null;
  return {
    operation: capture.operation,
    queryId: capture.queryId,
    bearer: typeof capture.bearer === 'string' ? capture.bearer : null,
    csrf: typeof capture.csrf === 'string' ? capture.csrf : null,
    operationHeaders: sanitizeOperationHeaders(capture.operationHeaders),
    operationTemplate: sanitizeOperationTemplate(capture.operationTemplate),
  };
}

export function captureFromRequest(rawUrl, rawHeaders, { method = 'GET', body = null } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl), 'https://x.com');
  } catch {
    return null;
  }
  if (url.origin !== 'https://x.com') return null;

  const match = url.pathname.match(/^\/i\/api\/graphql\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  let queryId;
  let operation;
  try {
    queryId = decodeURIComponent(match[1]);
    operation = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!OPERATION_PATTERN.test(operation) || !QUERY_ID_PATTERN.test(queryId)) return null;

  const headers = plainHeaders(rawHeaders);
  return sanitizeCapture({
    operation,
    queryId,
    bearer: headers.authorization ?? null,
    csrf: headers['x-csrf-token'] ?? null,
    operationHeaders: headers,
    operationTemplate: {
      method,
      params: Object.fromEntries(url.searchParams),
      body,
    },
  });
}

export function mergeAuth(current = {}, rawCapture) {
  const capture = sanitizeCapture(rawCapture);
  if (!capture) return current;
  return {
    bearer: capture.bearer ?? current.bearer ?? null,
    csrf: capture.csrf ?? current.csrf ?? null,
    queryIds: { ...(current.queryIds ?? {}), [capture.operation]: capture.queryId },
    operationHeaders: {
      ...(current.operationHeaders ?? {}),
      [capture.operation]: capture.operationHeaders,
    },
    operationTemplates: {
      ...(current.operationTemplates ?? {}),
      [capture.operation]: capture.operationTemplate,
    },
  };
}
