import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOOKMARKS_CAPTURE = {
  operation: 'Bookmarks',
  queryId: 'read123',
  bearer: 'Bearer session-secret',
  csrf: 'csrf-session-secret',
  operationHeaders: {
    'x-client-transaction-id': 'tx',
    cookie: 'must-not-persist',
  },
  operationTemplate: {
    method: 'GET',
    params: { variables: '{}', secret: 'must-not-persist' },
    body: null,
  },
};

async function loadBackground(set = vi.fn().mockResolvedValue(undefined)) {
  let listener;
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((callback) => { listener = callback; }),
      },
    },
    storage: { local: { set } },
  });
  await import('../src/background.js');
  return {
    invoke(message) {
      const sendResponse = vi.fn();
      return { returned: listener(message, {}, sendResponse), sendResponse };
    },
    set,
  };
}

describe('service-worker auth capture', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps session material in memory and persists query IDs only', async () => {
    const background = await loadBackground();
    const capture = background.invoke({ type: 'XBI_AUTH_CAPTURE', capture: BOOKMARKS_CAPTURE });

    expect(capture.returned).toBe(true);
    await vi.waitFor(() => expect(capture.sendResponse).toHaveBeenCalledWith({ ok: true }));
    expect(background.set).toHaveBeenCalledWith({ auth: { queryIds: { Bookmarks: 'read123' } } });
    const serializedWrite = JSON.stringify(background.set.mock.calls);
    expect(serializedWrite).not.toContain('Bearer session-secret');
    expect(serializedWrite).not.toContain('csrf-session-secret');
    expect(serializedWrite).not.toContain('operationHeaders');
    expect(serializedWrite).not.toContain('operationTemplates');

    const session = background.invoke({ type: 'XBI_GET_SESSION_AUTH' });
    expect(session.returned).toBe(false);
    expect(session.sendResponse).toHaveBeenCalledWith({
      bearer: 'Bearer session-secret',
      csrf: 'csrf-session-secret',
      queryIds: { Bookmarks: 'read123' },
      operationHeaders: { Bookmarks: { 'x-client-transaction-id': 'tx' } },
      operationTemplates: {
        Bookmarks: { method: 'GET', params: { variables: '{}' }, body: null },
      },
    });
  });

  it('merges operation IDs and rejects malformed captures without writing', async () => {
    const background = await loadBackground();
    const first = background.invoke({ type: 'XBI_AUTH_CAPTURE', capture: BOOKMARKS_CAPTURE });
    await vi.waitFor(() => expect(first.sendResponse).toHaveBeenCalled());
    const second = background.invoke({
      type: 'XBI_AUTH_CAPTURE',
      capture: {
        ...BOOKMARKS_CAPTURE,
        operation: 'DeleteBookmark',
        queryId: 'delete123',
      },
    });
    await vi.waitFor(() => expect(second.sendResponse).toHaveBeenCalled());

    expect(background.set).toHaveBeenLastCalledWith({
      auth: { queryIds: { Bookmarks: 'read123', DeleteBookmark: 'delete123' } },
    });
    const malformed = background.invoke({
      type: 'XBI_AUTH_CAPTURE',
      capture: { operation: '__proto__', queryId: 'bad/id', bearer: 'Bearer leaked' },
    });
    expect(malformed.returned).toBe(false);
    expect(malformed.sendResponse).not.toHaveBeenCalled();
    expect(background.set).toHaveBeenCalledTimes(2);
  });

  it('keeps the async channel open and reports storage failure without secrets', async () => {
    const background = await loadBackground(vi.fn().mockRejectedValue(new Error('disk includes secret?')));
    const capture = background.invoke({ type: 'XBI_AUTH_CAPTURE', capture: BOOKMARKS_CAPTURE });

    expect(capture.returned).toBe(true);
    await vi.waitFor(() => expect(capture.sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'Unable to persist query IDs',
    }));
  });
});
