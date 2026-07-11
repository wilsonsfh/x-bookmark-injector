import { OPERATIONS, X_ORIGIN } from './x-api/constants.js';

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
const BEARER_PATTERN = /^Bearer [A-Za-z0-9%._~+/-]{1,505}$/;
const CSRF_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const ALLOWED_OPERATIONS = new Set(Object.values(OPERATIONS));
const MAX_REQUEST_URL_LENGTH = 8192;
const MAX_REQUEST_BODY_CHARS = 1024 * 1024;
const MAX_RESULT_ERROR_CHARS = 512;
const MAX_RESULT_JSON_CHARS = 4 * 1024 * 1024;
export const TEMPLATE_BUDGETS = Object.freeze({
  maxDepth: 16,
  maxNodes: 10_000,
  maxStringBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

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

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function consumeString(budget, value, { enforceStringLimit = true } = {}) {
  const bytes = byteLength(value);
  if (enforceStringLimit && bytes > TEMPLATE_BUDGETS.maxStringBytes) throw new Error('Template string too large');
  budget.totalBytes += bytes;
  if (budget.totalBytes > TEMPLATE_BUDGETS.maxTotalBytes) throw new Error('Template too large');
}

function sanitizeJsonValue(value, budget, seen = new WeakSet(), depth = 0) {
  if (depth > TEMPLATE_BUDGETS.maxDepth) throw new Error('Template too deep');
  budget.nodes += 1;
  if (budget.nodes > TEMPLATE_BUDGETS.maxNodes) throw new Error('Template has too many nodes');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    consumeString(budget, value);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('Template value invalid');
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, budget, seen, depth + 1));
  }

  const sanitized = {};
  for (const key of Object.keys(value).sort()) {
    consumeString(budget, key);
    if (BLOCKED_DATA_KEYS.has(key.toLowerCase())) continue;
    sanitized[key] = sanitizeJsonValue(value[key], budget, seen, depth + 1);
  }
  return sanitized;
}

function sanitizeParams(input, budget) {
  const params = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!SAFE_PARAM_KEYS.has(key)) continue;
    if (typeof value !== 'string') throw new Error('Template parameter invalid');
    consumeString(budget, value, { enforceStringLimit: false });
    const parsed = JSON.parse(value);
    params[key] = JSON.stringify(sanitizeJsonValue(parsed, budget));
  }
  return params;
}

function sanitizeBody(rawBody, budget) {
  let body = rawBody;
  if (typeof body === 'string') {
    consumeString(budget, body, { enforceStringLimit: false });
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const sanitized = {};
  for (const key of Object.keys(body).sort()) {
    if (!SAFE_BODY_KEYS.has(key)) continue;
    consumeString(budget, key);
    sanitized[key] = sanitizeJsonValue(body[key], budget);
  }
  return sanitized;
}

function sanitizeOperationHeaders(input) {
  const headers = plainHeaders(input);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_HEADER_KEYS.has(key)),
  );
}

function sanitizeOperationTemplate(input) {
  const template = isPlainObject(input) ? input : {};
  const budget = { nodes: 0, totalBytes: 0 };
  const method = String(template.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  return {
    method,
    params: sanitizeParams(template.params, budget),
    body: sanitizeBody(template.body, budget),
  };
}

export function parseXGraphqlUrl(rawUrl, { absoluteOnly = false } = {}) {
  let url;
  try {
    const value = String(rawUrl);
    if (!value || value.length > MAX_REQUEST_URL_LENGTH) return null;
    url = absoluteOnly ? new URL(value) : new URL(value, X_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== X_ORIGIN || url.username || url.password) return null;

  const match = url.pathname.match(/^\/i\/api\/graphql\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  try {
    const queryId = decodeURIComponent(match[1]);
    const operation = decodeURIComponent(match[2]);
    if (
      !QUERY_ID_PATTERN.test(queryId)
      || !OPERATION_PATTERN.test(operation)
      || !ALLOWED_OPERATIONS.has(operation)
    ) return null;
    return { operation, queryId, url };
  } catch {
    return null;
  }
}

export function validatePageRequest(request) {
  if (!isPlainObject(request) || !isPlainObject(request.init)) return null;
  const parsed = parseXGraphqlUrl(request.url, { absoluteOnly: true });
  if (!parsed) return null;

  const expectedMethod = parsed.operation === OPERATIONS.BOOKMARKS ? 'GET' : 'POST';
  const method = String(request.init.method ?? 'GET').toUpperCase();
  const headers = plainHeaders(request.init.headers);
  if (
    method !== expectedMethod
    || request.init.credentials !== 'include'
    || !BEARER_PATTERN.test(headers.authorization ?? '')
    || !CSRF_PATTERN.test(headers['x-csrf-token'] ?? '')
  ) return null;
  if (method === 'GET' && request.init.body != null) return null;
  if (
    method === 'POST'
    && (typeof request.init.body !== 'string' || request.init.body.length > MAX_REQUEST_BODY_CHARS)
  ) return null;
  return parsed;
}

export function validateExecutionResult(message, expectedOperation) {
  if (!isPlainObject(message) || message.operation !== expectedOperation) return false;
  const allowedKeys = new Set([
    'error',
    'ok',
    'operation',
    'payload',
    'requestId',
    'source',
    'status',
    'type',
  ]);
  if (Object.keys(message).some((key) => !allowedKeys.has(key))) return false;
  if (
    typeof message.ok !== 'boolean'
    || !Number.isInteger(message.status)
    || message.status < 0
    || message.status > 599
    || (message.ok && (message.status < 200 || message.status > 299))
  ) return false;
  if (message.error !== undefined) {
    if (typeof message.error !== 'string' || !message.error || message.error.length > MAX_RESULT_ERROR_CHARS) {
      return false;
    }
  }
  if (message.payload !== undefined) {
    if (message.payload === null || typeof message.payload !== 'object') return false;
    try {
      if (JSON.stringify(message.payload).length > MAX_RESULT_JSON_CHARS) return false;
    } catch {
      return false;
    }
  }
  return message.ok ? message.payload !== undefined : message.payload !== undefined || message.error !== undefined;
}

export function sanitizeCapture(capture) {
  if (!capture || typeof capture !== 'object') return null;
  if (
    !OPERATION_PATTERN.test(capture.operation)
    || !ALLOWED_OPERATIONS.has(capture.operation)
    || !QUERY_ID_PATTERN.test(capture.queryId)
    || typeof capture.bearer !== 'string'
    || !BEARER_PATTERN.test(capture.bearer)
    || typeof capture.csrf !== 'string'
    || !CSRF_PATTERN.test(capture.csrf)
  ) return null;
  let operationTemplate;
  try {
    operationTemplate = sanitizeOperationTemplate(capture.operationTemplate);
  } catch {
    return null;
  }
  const expectedMethod = capture.operation === OPERATIONS.BOOKMARKS ? 'GET' : 'POST';
  if (operationTemplate.method !== expectedMethod) return null;
  return {
    operation: capture.operation,
    queryId: capture.queryId,
    bearer: capture.bearer,
    csrf: capture.csrf,
    operationHeaders: sanitizeOperationHeaders(capture.operationHeaders),
    operationTemplate,
  };
}

export function captureFromRequest(rawUrl, rawHeaders, { method = 'GET', body = null } = {}) {
  const parsed = parseXGraphqlUrl(rawUrl);
  if (!parsed) return null;

  const headers = plainHeaders(rawHeaders);
  return sanitizeCapture({
    operation: parsed.operation,
    queryId: parsed.queryId,
    bearer: headers.authorization ?? null,
    csrf: headers['x-csrf-token'] ?? null,
    operationHeaders: headers,
    operationTemplate: {
      method,
      params: Object.fromEntries(parsed.url.searchParams),
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
