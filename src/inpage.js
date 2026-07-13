import {
  captureFromRequest,
  EXT_SOURCE,
  PAGE_SOURCE,
  parseXGraphqlUrl,
  validatePageRequest,
} from './bridge.js';
import { OPERATIONS } from './x-api/constants.js';

export const MAIN_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

async function readResponseText(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Page response too large');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Page response too large');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Page response too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function installInpageBridge(scope, {
  HeadersCtor = Headers,
  RequestCtor = Request,
  XMLHttpRequestCtor = XMLHttpRequest,
} = {}) {
  const realFetch = scope.fetch.bind(scope);

  function mergedHeaders(input, init) {
    const headers = new HeadersCtor(input instanceof RequestCtor ? input.headers : undefined);
    new HeadersCtor(init?.headers).forEach((value, key) => headers.set(key, value));
    return headers;
  }

  function publishCapture(input, init) {
    const url = input instanceof RequestCtor ? input.url : String(input);
    const capture = captureFromRequest(url, mergedHeaders(input, init), {
      method: init?.method ?? (input instanceof RequestCtor ? input.method : 'GET'),
      body: init?.body ?? null,
    });
    if (capture) {
      scope.postMessage({ source: PAGE_SOURCE, type: 'XBI_AUTH_CAPTURE', capture }, '*');
    }
    // A user adding/removing a bookmark on X fires CreateBookmark/DeleteBookmark
    // through the page's own fetch/XHR. Signal it so the extension can auto-sync.
    // The extension's own mutations use the unwrapped fetch, so they never loop here.
    const parsed = parseXGraphqlUrl(url);
    if (parsed && (parsed.operation === OPERATIONS.CREATE || parsed.operation === OPERATIONS.DELETE)) {
      scope.postMessage({ source: PAGE_SOURCE, type: 'XBI_BOOKMARK_CHANGED', operation: parsed.operation }, '*');
    }
  }

  scope.fetch = function xbiFetch(input, init) {
    try {
      publishCapture(input, init);
    } catch {
      // Capture must never interfere with X's request.
    }
    return realFetch(input, init);
  };

  const xhrRequests = new WeakMap();
  const realOpen = XMLHttpRequestCtor.prototype.open;
  const realSetHeader = XMLHttpRequestCtor.prototype.setRequestHeader;
  const realSend = XMLHttpRequestCtor.prototype.send;
  XMLHttpRequestCtor.prototype.open = function xbiOpen(method, url, ...rest) {
    const result = realOpen.call(this, method, url, ...rest);
    xhrRequests.set(this, { method, url, headers: {} });
    return result;
  };
  XMLHttpRequestCtor.prototype.setRequestHeader = function xbiSetRequestHeader(key, value) {
    const result = realSetHeader.call(this, key, value);
    const request = xhrRequests.get(this);
    if (request) request.headers[key] = value;
    return result;
  };
  XMLHttpRequestCtor.prototype.send = function xbiSend(body) {
    const request = xhrRequests.get(this);
    xhrRequests.delete(this);
    if (request) {
      try {
        publishCapture(request.url, { ...request, body });
      } catch {
        // Capture must never interfere with X's request.
      }
    }
    return realSend.call(this, body);
  };

  scope.addEventListener('message', async (event) => {
    const message = event.data;
    if (
      event.source !== scope
      || message?.source !== EXT_SOURCE
      || message.type !== 'XBI_EXECUTE'
      || typeof message.requestId !== 'string'
      || !message.requestId
    ) return;

    const { requestId, request } = message;
    let operation = null;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MAIN_REQUEST_TIMEOUT_MS);
    try {
      const parsedRequest = validatePageRequest(request);
      if (!parsedRequest) throw new Error('Blocked non-X GraphQL page request');
      operation = parsedRequest.operation;
      const response = await realFetch(parsedRequest.url.href, {
        ...request.init,
        redirect: 'error',
        signal: controller.signal,
      });
      const responseUrl = parseXGraphqlUrl(response.url, { absoluteOnly: true });
      if (
        !responseUrl
        || responseUrl.url.pathname !== parsedRequest.url.pathname
      ) {
        throw new Error('Blocked redirected GraphQL response');
      }
      const text = await readResponseText(response);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { text };
      }
      scope.postMessage({
        source: PAGE_SOURCE,
        type: 'XBI_EXECUTE_RESULT',
        requestId,
        operation,
        ok: response.ok,
        status: response.status,
        payload,
      }, '*');
    } catch (error) {
      scope.postMessage({
        source: PAGE_SOURCE,
        type: 'XBI_EXECUTE_RESULT',
        requestId,
        ...(operation ? { operation } : {}),
        ok: false,
        status: 0,
        error: timedOut
          ? 'Page request timed out'
          : error instanceof Error ? error.message : 'Page request failed',
      }, '*');
    } finally {
      clearTimeout(timeout);
    }
  });
}

if (typeof window !== 'undefined' && typeof XMLHttpRequest !== 'undefined') {
  installInpageBridge(window);
}
