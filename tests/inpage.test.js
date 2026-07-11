import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXT_SOURCE, PAGE_SOURCE } from '../src/bridge.js';
import {
  installInpageBridge,
  MAIN_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} from '../src/inpage.js';

class FakeXMLHttpRequest {
  open(...args) {
    this.openArgs = args;
  }

  setRequestHeader(...args) {
    this.headerArgs ??= [];
    this.headerArgs.push(args);
  }

  send(body) {
    this.sentBody = body;
  }
}

function pageRequest(url, init = {}) {
  return {
    url,
    init: {
      method: 'GET',
      credentials: 'include',
      headers: {
        authorization: 'Bearer session',
        'x-csrf-token': 'csrf-session',
      },
      ...init,
    },
  };
}

function makeScope(fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  url: 'https://x.com/i/api/graphql/read123/Bookmarks',
  text: vi.fn().mockResolvedValue('{"data":{"ok":true}}'),
}), bridgeOptions = {}) {
  let messageListener;
  const scope = {
    fetch,
    postMessage: vi.fn(),
    addEventListener: vi.fn((type, listener) => {
      if (type === 'message') messageListener = listener;
    }),
  };
  installInpageBridge(scope, {
    HeadersCtor: Headers,
    RequestCtor: Request,
    XMLHttpRequestCtor: FakeXMLHttpRequest,
    ...bridgeOptions,
  });
  return { scope, message: (data, source = scope) => messageListener({ data, source }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MAIN-world bridge', () => {
  it('captures fetch and XHR auth while delegating the original requests', async () => {
    const { scope } = makeScope();

    await scope.fetch('https://x.com/i/api/graphql/read123/Bookmarks?variables=%7B%7D', {
      headers: { authorization: 'Bearer secret', 'x-csrf-token': 'csrf' },
    });
    const xhr = new FakeXMLHttpRequest();
    xhr.open('POST', 'https://x.com/i/api/graphql/delete123/DeleteBookmark');
    xhr.setRequestHeader('Authorization', 'Bearer xhr-secret');
    xhr.setRequestHeader('x-csrf-token', 'xhr-csrf');
    xhr.send('{"variables":{"tweet_id":"1"}}');

    expect(scope.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: PAGE_SOURCE,
      type: 'XBI_AUTH_CAPTURE',
      capture: expect.objectContaining({ operation: 'Bookmarks', queryId: 'read123' }),
    }), '*');
    expect(scope.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: PAGE_SOURCE,
      type: 'XBI_AUTH_CAPTURE',
      capture: expect.objectContaining({ operation: 'DeleteBookmark', queryId: 'delete123' }),
    }), '*');
    expect(xhr.openArgs).toEqual(['POST', 'https://x.com/i/api/graphql/delete123/DeleteBookmark']);
    expect(xhr.sentBody).toBe('{"variables":{"tweet_id":"1"}}');
    expect(xhr).not.toHaveProperty('__xbi');
  });

  it('does not disrupt the original fetch when capture parsing fails', async () => {
    const fetch = vi.fn().mockResolvedValue('original-result');
    class ThrowingHeaders {
      constructor() {
        throw new Error('capture failed');
      }
    }
    const { scope } = makeScope(fetch, { HeadersCtor: ThrowingHeaders });

    await expect(scope.fetch('https://x.com/i/api/graphql/read123/Bookmarks')).resolves.toBe('original-result');
    expect(fetch).toHaveBeenCalledOnce();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  it('executes an exact X GraphQL URL and correlates the JSON result', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://x.com/i/api/graphql/read123/Bookmarks?variables=%7B%7D',
      text: vi.fn().mockResolvedValue('{"data":{"bookmark_timeline_v2":{}}}'),
    });
    const { message, scope } = makeScope(fetch);
    const request = pageRequest('https://x.com/i/api/graphql/read123/Bookmarks?variables=%7B%7D');

    await message({ source: EXT_SOURCE, type: 'XBI_EXECUTE', requestId: 'request-1', request });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(request.url, {
      ...request.init,
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      source: PAGE_SOURCE,
      type: 'XBI_EXECUTE_RESULT',
      requestId: 'request-1',
      operation: 'Bookmarks',
      ok: true,
      status: 200,
      payload: { data: { bookmark_timeline_v2: {} } },
    }, '*');
  });

  it('aborts MAIN requests before the relay timeout and clears the timer', async () => {
    vi.useFakeTimers();
    let signal;
    const fetch = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const { message, scope } = makeScope(fetch);

    const execution = message({
      source: EXT_SOURCE,
      type: 'XBI_EXECUTE',
      requestId: 'request-timeout',
      request: pageRequest('https://x.com/i/api/graphql/read123/Bookmarks'),
    });
    await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
    await execution;

    expect(MAIN_REQUEST_TIMEOUT_MS).toBeLessThan(20_000);
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 'request-timeout',
      ok: false,
      error: 'Page request timed out',
    }), '*');
  });

  it('rejects redirected response URLs even when fetch returns success', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/i/api/graphql/read123/Bookmarks',
      text: vi.fn().mockResolvedValue('{"data":{}}'),
    });
    const { message, scope } = makeScope(fetch);

    await message({
      source: EXT_SOURCE,
      type: 'XBI_EXECUTE',
      requestId: 'request-redirect',
      request: pageRequest('https://x.com/i/api/graphql/read123/Bookmarks'),
    });

    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 'request-redirect',
      ok: false,
      error: 'Blocked redirected GraphQL response',
    }), '*');
  });

  it('rejects responses larger than the byte cap', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://x.com/i/api/graphql/read123/Bookmarks',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    });
    const { message, scope } = makeScope(fetch);

    await message({
      source: EXT_SOURCE,
      type: 'XBI_EXECUTE',
      requestId: 'request-large',
      request: pageRequest('https://x.com/i/api/graphql/read123/Bookmarks'),
    });

    expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 'request-large',
      ok: false,
      error: 'Page response too large',
    }), '*');
  });

  it.each([
    'https://example.com/i/api/graphql/read123/Bookmarks',
    'http://x.com/i/api/graphql/read123/Bookmarks',
    'https://x.com.evil.test/i/api/graphql/read123/Bookmarks',
    'https://x.com/i/api/graphqlish/read123/Bookmarks',
    'https://x.com/i/api/graphql/read123/Bookmarks/extra',
    '/i/api/graphql/read123/Bookmarks',
  ])('blocks executor URL %s before fetch', async (url) => {
    const fetch = vi.fn();
    const { message, scope } = makeScope(fetch);

    await message({
      source: EXT_SOURCE,
      type: 'XBI_EXECUTE',
      requestId: 'request-2',
      request: pageRequest(url),
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      source: PAGE_SOURCE,
      type: 'XBI_EXECUTE_RESULT',
      requestId: 'request-2',
      ok: false,
      status: 0,
      error: 'Blocked non-X GraphQL page request',
    }), '*');
  });

  it('ignores uncorrelated or wrong-source execute messages', async () => {
    const fetch = vi.fn();
    const { message, scope } = makeScope(fetch);
    const execute = {
      source: EXT_SOURCE,
      type: 'XBI_EXECUTE',
      requestId: '',
      request: pageRequest('https://x.com/i/api/graphql/read123/Bookmarks'),
    };

    await message(execute, {});
    await message({ ...execute, source: PAGE_SOURCE });
    await message({ ...execute, requestId: '' });

    expect(fetch).not.toHaveBeenCalled();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });
});
