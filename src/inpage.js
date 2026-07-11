import { captureFromRequest, EXT_SOURCE, PAGE_SOURCE } from './bridge.js';

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
    try {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        throw new Error('Blocked non-X GraphQL page request');
      }
      if (
        url.origin !== 'https://x.com'
        || url.username
        || url.password
        || captureFromRequest(url.href, {}) === null
      ) {
        throw new Error('Blocked non-X GraphQL page request');
      }
      const response = await realFetch(url.href, request.init);
      const text = await response.text();
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
        ok: response.ok,
        status: response.status,
        payload,
      }, '*');
    } catch (error) {
      scope.postMessage({
        source: PAGE_SOURCE,
        type: 'XBI_EXECUTE_RESULT',
        requestId,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : 'Page request failed',
      }, '*');
    }
  });
}

if (typeof window !== 'undefined' && typeof XMLHttpRequest !== 'undefined') {
  installInpageBridge(window);
}
