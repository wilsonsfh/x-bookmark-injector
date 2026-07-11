import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countLeft } from '../src/core/count.js';

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
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
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

const SESSION_AUTH = {
  bearer: 'Bearer session-secret',
  csrf: 'csrf-session-secret',
  queryIds: {
    Bookmarks: 'read123',
    DeleteBookmark: 'delete123',
    CreateBookmark: 'create123',
  },
  operationHeaders: {},
  operationTemplates: {
    Bookmarks: { method: 'GET', params: { variables: '{}' }, body: null },
    DeleteBookmark: { method: 'POST', params: {}, body: { variables: {} } },
    CreateBookmark: { method: 'POST', params: {}, body: { variables: {} } },
  },
};

const OPERATIONAL_STATE = {
  bookmarks: { old: { id: 'old', text: 'old cache', saveRank: 1 } },
  cleared: {},
  meta: { total: 1, lastSync: null, syncStatus: 'idle', syncError: null },
  auth: { queryIds: SESSION_AUTH.queryIds },
  settings: {
    confirmRealDelete: true,
    deleteConfirmed: false,
    keepCooldownHours: 72,
    syncEveryHours: 24,
  },
};

function bookmarkPayload(ids, nextCursor = null) {
  const entries = ids.map((id) => ({
    entryId: `tweet-${id}`,
    content: {
      itemContent: {
        tweet_results: {
          result: {
            rest_id: id,
            legacy: { full_text: `tweet ${id}` },
            core: { user_results: { result: { legacy: { screen_name: 'author' } } } },
          },
        },
      },
    },
  }));
  if (nextCursor) entries.push({
    entryId: 'cursor-bottom-0',
    content: { cursorType: 'Bottom', value: nextCursor },
  });
  return {
    data: {
      bookmark_timeline_v2: {
        timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] },
      },
    },
  };
}

async function loadOperationalBackground({
  pageRequest,
  pageAuth = SESSION_AUTH,
  initialState = OPERATIONAL_STATE,
  setImplementation = async () => {},
  sessionSetImplementation = async () => {},
  sessionRemoveImplementation = async () => {},
  tabQuery = vi.fn().mockResolvedValue([]),
  stores = {
    local: structuredClone(initialState),
    session: {},
  },
} = {}) {
  let listener;
  const set = vi.fn(async (patch) => {
    await setImplementation(patch);
    stores.local = { ...stores.local, ...structuredClone(patch) };
  });
  const sessionSet = vi.fn(async (patch) => {
    await sessionSetImplementation(patch);
    stores.session = { ...stores.session, ...structuredClone(patch) };
  });
  const sendMessage = vi.fn(async (tabId, message) => {
    if (message.type === 'XBI_GET_PAGE_AUTH') {
      const auth = typeof pageAuth === 'function' ? await pageAuth(tabId) : pageAuth;
      return structuredClone(auth);
    }
    if (message.type === 'XBI_PAGE_REQUEST') return pageRequest(message.request);
    return undefined;
  });
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: vi.fn((callback) => { listener = callback; }) } },
    storage: {
      local: { get: vi.fn(async () => structuredClone(stores.local)), set },
      session: {
        get: vi.fn(async () => structuredClone(stores.session)),
        set: sessionSet,
        remove: vi.fn(async (key) => {
          await sessionRemoveImplementation(key);
          delete stores.session[key];
        }),
      },
    },
    tabs: { query: tabQuery, sendMessage },
  });
  await import('../src/background.js');
  return {
    getState: () => structuredClone(stores.local),
    getSession: () => structuredClone(stores.session),
    sendMessage,
    sessionSet,
    set,
    stores,
    invoke(message, sender = { tab: { id: 7 } }) {
      return new Promise((resolve) => {
        const returned = listener(message, sender, resolve);
        if (returned !== true) throw new Error('Expected async message channel');
      });
    },
    invokeSync(message, sender = { tab: { id: 7 } }) {
      const sendResponse = vi.fn();
      const returned = listener(message, sender, sendResponse);
      return { returned, response: sendResponse.mock.calls[0]?.[0] };
    },
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
        operationTemplate: { ...BOOKMARKS_CAPTURE.operationTemplate, method: 'POST' },
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

  it('caps persisted IDs to bookmark operations and deduplicates unchanged IDs', async () => {
    const background = await loadBackground();
    for (const [operation, queryId] of [
      ['Bookmarks', 'read123'],
      ['DeleteBookmark', 'delete123'],
      ['CreateBookmark', 'create123'],
    ]) {
      const result = background.invoke({
        type: 'XBI_AUTH_CAPTURE',
        capture: {
          ...BOOKMARKS_CAPTURE,
          operation,
          queryId,
          operationTemplate: {
            ...BOOKMARKS_CAPTURE.operationTemplate,
            method: operation === 'Bookmarks' ? 'GET' : 'POST',
          },
        },
      });
      await vi.waitFor(() => expect(result.sendResponse).toHaveBeenCalledWith({ ok: true }));
    }

    const duplicate = background.invoke({
      type: 'XBI_AUTH_CAPTURE',
      capture: { ...BOOKMARKS_CAPTURE, bearer: 'Bearer rotated-session' },
    });

    expect(duplicate.returned).toBe(false);
    expect(duplicate.sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(background.set).toHaveBeenCalledTimes(3);
    expect(background.set).toHaveBeenLastCalledWith({
      auth: {
        queryIds: {
          Bookmarks: 'read123',
          DeleteBookmark: 'delete123',
          CreateBookmark: 'create123',
        },
      },
    });
    const session = background.invoke({ type: 'XBI_GET_SESSION_AUTH' });
    expect(session.sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      bearer: 'Bearer rotated-session',
      queryIds: {
        Bookmarks: 'read123',
        DeleteBookmark: 'delete123',
        CreateBookmark: 'create123',
      },
    }));
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

describe('service-worker bookmark sync', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns public local state without memory-only session material', async () => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn() });

    const state = await background.invoke({ type: 'XBI_GET_STATE' });

    expect(state.auth).toEqual({ queryIds: SESSION_AUTH.queryIds });
    expect(JSON.stringify(state)).not.toContain('session-secret');
    expect(state).not.toHaveProperty('operationHeaders');
    expect(state).not.toHaveProperty('operationTemplates');
  });

  it('uses another open X tab when the active tab has not loaded the extension bridge', async () => {
    const tabQuery = vi.fn().mockResolvedValue([
      { id: 8, active: true },
      { id: 9, active: false },
    ]);
    const pageAuth = vi.fn(async (tabId) => {
      if (tabId === 8) throw new Error('Receiving end does not exist');
      return SESSION_AUTH;
    });
    const background = await loadOperationalBackground({
      pageAuth,
      pageRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, payload: bookmarkPayload(['new']) }),
      tabQuery,
    });

    await expect(background.invoke({ type: 'XBI_SYNC' }, {})).resolves.toEqual({ ok: true, total: 1 });
    expect(background.sendMessage.mock.calls.some(([tabId, message]) => (
      tabId === 9 && message.type === 'XBI_PAGE_REQUEST'
    ))).toBe(true);
  });

  it('falls back from an unauthenticated sender tab to another captured X tab', async () => {
    const tabQuery = vi.fn().mockResolvedValue([{ id: 9, active: false }]);
    const pageAuth = vi.fn(async (tabId) => {
      if (tabId === 8) throw new Error('sender bridge unavailable');
      return SESSION_AUTH;
    });
    const background = await loadOperationalBackground({
      pageAuth,
      pageRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, payload: bookmarkPayload(['new']) }),
      tabQuery,
    });

    await expect(background.invoke({ type: 'XBI_SYNC' }, { tab: { id: 8 } }))
      .resolves.toEqual({ ok: true, total: 1 });
    expect(background.sendMessage.mock.calls.some(([tabId, message]) => (
      tabId === 9 && message.type === 'XBI_PAGE_REQUEST'
    ))).toBe(true);
  });

  it('publishes a fully paginated cache once all pages succeed', async () => {
    const pages = [bookmarkPayload(['new'], 'C2'), bookmarkPayload(['old'])];
    const background = await loadOperationalBackground({
      pageRequest: vi.fn(async () => ({ ok: true, status: 200, payload: pages.shift() })),
    });

    await expect(background.invoke({ type: 'XBI_SYNC' })).resolves.toEqual({ ok: true, total: 2 });

    const publication = background.set.mock.calls.find(([patch]) => patch.bookmarks)?.[0];
    expect(publication.bookmarks).toMatchObject({
      new: { id: 'new', saveRank: 2 },
      old: { id: 'old', text: 'tweet old', saveRank: 1 },
    });
    expect(publication.meta).toMatchObject({ total: 2, syncStatus: 'idle', syncError: null });
    expect(background.sendMessage.mock.calls.filter(([, message]) => message.type === 'XBI_PAGE_REQUEST')).toHaveLength(2);
  });

  it('continues pagination from a module-contained Bottom cursor', async () => {
    const firstPage = bookmarkPayload(['new']);
    firstPage.data.bookmark_timeline_v2.timeline.instructions[0].entries.push({
      entryId: 'module-cursor-0',
      content: {
        items: [{
          entryId: 'cursor-bottom-0',
          item: { itemContent: { cursorType: 'Bottom', value: 'MODULE_C2' } },
        }],
      },
    });
    const pages = [firstPage, bookmarkPayload(['old'])];
    const pageRequest = vi.fn(async () => ({ ok: true, status: 200, payload: pages.shift() }));
    const background = await loadOperationalBackground({ pageRequest });

    await expect(background.invoke({ type: 'XBI_SYNC' })).resolves.toEqual({ ok: true, total: 2 });

    expect(pageRequest).toHaveBeenCalledTimes(2);
    const secondVariables = JSON.parse(new URL(pageRequest.mock.calls[1][0].url).searchParams.get('variables'));
    expect(secondVariables.cursor).toBe('MODULE_C2');
  });

  it('deduplicates cross-page tweet IDs before assigning contiguous ranks and totals', async () => {
    const newestPage = bookmarkPayload(['newest', 'duplicate'], 'C2');
    newestPage.data.bookmark_timeline_v2.timeline.instructions[0]
      .entries[1].content.itemContent.tweet_results.result.legacy.full_text = 'newer duplicate';
    const oldestPage = bookmarkPayload(['duplicate', 'oldest']);
    oldestPage.data.bookmark_timeline_v2.timeline.instructions[0]
      .entries[0].content.itemContent.tweet_results.result.legacy.full_text = 'older duplicate';
    const pages = [newestPage, oldestPage];
    const background = await loadOperationalBackground({
      pageRequest: vi.fn(async () => ({ ok: true, status: 200, payload: pages.shift() })),
    });

    await expect(background.invoke({ type: 'XBI_SYNC' })).resolves.toEqual({ ok: true, total: 3 });

    const state = background.getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(3);
    expect(state.meta.total).toBe(Object.keys(state.bookmarks).length);
    expect(state.bookmarks).toMatchObject({
      newest: { saveRank: 3 },
      duplicate: { text: 'newer duplicate', saveRank: 2 },
      oldest: { saveRank: 1 },
    });
  });

  it.each([
    [{ ok: false, status: 429, error: 'rate limited' }, 'Rate limited by X; try later'],
    [undefined, 'X request failed'],
    [{ ok: true, status: 200, payload: undefined }, 'response invalid'],
    [{
      ok: true,
      status: 200,
      payload: {
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [{
                type: 'TimelineAddEntries',
                entries: [{
                  entryId: 'tweet-bad',
                  content: { itemContent: { tweet_results: { result: { legacy: {} } } } },
                }],
              }],
            },
          },
        },
      },
    }, 'integration response invalid'],
    [{
      ok: true,
      status: 200,
      payload: (() => {
        const payload = bookmarkPayload(['conflict'], 'FIRST');
        payload.data.bookmark_timeline_v2.timeline.instructions[0].entries.push({
          entryId: 'module-cursor-0',
          content: {
            items: [{
              entryId: 'cursor-bottom-1',
              item: { itemContent: { cursorType: 'Bottom', value: 'SECOND' } },
            }],
          },
        });
        return payload;
      })(),
    }, 'integration response invalid'],
    [{
      ok: true,
      status: 200,
      payload: {
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [{
                type: 'TimelineAddEntries',
                entries: [{ entryId: 'module-bad-0', content: { items: [{}] } }],
              }],
            },
          },
        },
      },
    }, 'integration response invalid'],
    [{
      ok: true,
      status: 200,
      payload: (() => {
        const payload = bookmarkPayload(['bad-date']);
        payload.data.bookmark_timeline_v2.timeline.instructions[0]
          .entries[0].content.itemContent.tweet_results.result.legacy.created_at = 'not-a-date';
        return payload;
      })(),
    }, 'Invalid time value'],
  ])('retains the old cache when a page fails: %j', async (response, expectedError) => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn().mockResolvedValue(response) });

    const result = await background.invoke({ type: 'XBI_SYNC' });

    expect(result.ok).toBe(false);
    expect(background.set.mock.calls.some(([patch]) => Object.hasOwn(patch, 'bookmarks'))).toBe(false);
    expect(background.getState().bookmarks).toEqual(OPERATIONAL_STATE.bookmarks);
    expect(background.getState().meta).toMatchObject({ syncStatus: 'error', syncError: expect.stringContaining(expectedError) });
  });

  it('shares one in-flight pagination request across concurrent sync messages', async () => {
    let resolvePage;
    const pageRequest = vi.fn(() => new Promise((resolve) => { resolvePage = resolve; }));
    const background = await loadOperationalBackground({ pageRequest });

    const first = background.invoke({ type: 'XBI_SYNC' });
    const second = background.invoke({ type: 'XBI_SYNC' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    resolvePage({ ok: true, status: 200, payload: bookmarkPayload(['only']) });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, total: 1 },
      { ok: true, total: 1 },
    ]);
    expect(pageRequest).toHaveBeenCalledOnce();
    expect(background.set.mock.calls.filter(([patch]) => patch.bookmarks)).toHaveLength(1);
  });

  it('clears single-flight state when the initial syncing write fails', async () => {
    const setImplementation = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    const pageRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: bookmarkPayload(['retry']),
    });
    const background = await loadOperationalBackground({ pageRequest, setImplementation });

    await expect(background.invoke({ type: 'XBI_SYNC' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('storage unavailable') });
    await expect(background.invoke({ type: 'XBI_SYNC' }))
      .resolves.toEqual({ ok: true, total: 1 });
    expect(pageRequest).toHaveBeenCalledOnce();
  });

  it('invalidates only the stale Bookmarks query ID on 404 and retains the old cache', async () => {
    const background = await loadOperationalBackground({
      pageRequest: vi.fn().mockResolvedValue({ ok: false, status: 404, error: 'not found' }),
    });

    await expect(background.invoke({ type: 'XBI_SYNC' })).resolves.toMatchObject({
      ok: false,
      status: 404,
    });

    expect(background.getState().bookmarks).toEqual(OPERATIONAL_STATE.bookmarks);
    expect(background.getState().auth.queryIds).toEqual({
      DeleteBookmark: 'delete123',
      CreateBookmark: 'create123',
    });
    expect(background.getState().meta.syncError).toContain('Open X Bookmarks to recapture');
    const session = background.invokeSync({ type: 'XBI_GET_SESSION_AUTH' });
    expect(session.response.queryIds).toEqual({
      DeleteBookmark: 'delete123',
      CreateBookmark: 'create123',
    });
  });
});

describe('service-worker bookmark actions', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps locally without page auth, mutation traffic, or reducing the cache', async () => {
    const pageRequest = vi.fn();
    const background = await loadOperationalBackground({ pageRequest });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'keep', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });

    expect(background.sendMessage).not.toHaveBeenCalled();
    expect(pageRequest).not.toHaveBeenCalled();
    expect(background.getState().bookmarks).toEqual(OPERATIONAL_STATE.bookmarks);
    expect(background.getState().cleared.old).toMatchObject({ action: 'keep', at: expect.any(String) });
  });

  it.each([
    [{ ok: false, status: 500, error: 'delete failed' }, 'delete failed'],
    [undefined, 'X request failed'],
    [{ ok: true, status: 200, payload: {} }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { errors: [{ message: 'nope' }], data: {} } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { errors: { message: 'nope' }, data: { result: 'Done' } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { data: { result: null } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { data: { unrelated: 'Done' } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { data: { tweet_bookmark_put: 'Done' } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: { success: false } } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'done' } } }, 'mutation response invalid'],
    [{ ok: true, status: 200, payload: { errors: [{ message: 'nope' }], data: { tweet_bookmark_delete: 'Done' } } }, 'mutation response invalid'],
  ])('returns bounded recovery for uncertain mutation outcomes: %j', async (response, _error) => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn().mockResolvedValue(response) });

    const result = await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });

    expect(result).toMatchObject({
      ok: true,
      recovery: true,
      reconciliationPending: true,
      undoUntil: expect.any(Number),
    });
    expect(background.getState().cleared.old).toMatchObject({ action: 'reconciliation' });
    expect(background.getState().pendingActions.old).toMatchObject({ phase: 'reconciliation' });
    expect(background.getState().settings.deleteConfirmed).toBe(false);
  });

  it.each([
    { data: { unrelated: 'Done' } },
    { data: { tweet_bookmark_delete: 'Done' } },
    { data: { tweet_bookmark_put: { success: false } } },
    { data: { tweet_bookmark_put: 'done' } },
    { errors: [{ message: 'nope' }], data: { tweet_bookmark_put: 'Done' } },
  ])('retains Done unless CreateBookmark returns its exact success field: %j', async (payload) => {
    vi.useFakeTimers();
    const pageRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: { data: { tweet_bookmark_delete: 'Done' } },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, payload });
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('mutation response invalid') });
    expect(background.getState().cleared.old.action).toBe('done');
  });

  it('marks Done only after delete success and restores it through CreateBookmark within 6 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const background = await loadOperationalBackground({ pageRequest });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toEqual({ ok: true, undoUntil: Date.now() + 6_000 });
    expect(background.getState().cleared.old).toMatchObject({ action: 'done' });
    expect(background.getState().settings.deleteConfirmed).toBe(true);

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(background.getState().cleared.old).toBeUndefined();
    expect(pageRequest.mock.calls.map(([request]) => request.url.split('/').at(-1)))
      .toEqual(['DeleteBookmark', 'CreateBookmark']);
  });

  it('treats session cleanup as best-effort after Undo restores local state', async () => {
    vi.useFakeTimers();
    const stores = { local: structuredClone(OPERATIONAL_STATE), session: {} };
    let sessionOutage = false;
    const sessionSetImplementation = vi.fn(async () => {
      if (sessionOutage) throw new Error('session storage unavailable');
    });
    const sessionRemoveImplementation = vi.fn(async () => {
      if (sessionOutage) throw new Error('session storage unavailable');
    });
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const firstWorker = await loadOperationalBackground({
      pageRequest,
      sessionSetImplementation,
      sessionRemoveImplementation,
      stores,
    });
    await firstWorker.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    sessionOutage = true;

    await expect(firstWorker.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(firstWorker.getState().cleared.old).toBeUndefined();
    expect(firstWorker.getState().pendingActions).toEqual({});
    expect(firstWorker.getState().bookmarks.old).toEqual(OPERATIONAL_STATE.bookmarks.old);
    expect(firstWorker.getSession().pendingUndo.old).toBeDefined();

    vi.resetModules();
    const restartedWorker = await loadOperationalBackground({
      pageRequest,
      sessionSetImplementation,
      sessionRemoveImplementation,
      stores,
    });
    await expect(restartedWorker.invoke({ type: 'XBI_GET_STATE' })).resolves.toMatchObject({
      pendingUndo: {},
      pendingActions: {},
    });
  });

  it('persists a delete intent and bookmark snapshot before calling X', async () => {
    let resolveDelete;
    const pageRequest = vi.fn(() => new Promise((resolve) => { resolveDelete = resolve; }));
    const background = await loadOperationalBackground({ pageRequest });

    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());

    expect(background.getState().pendingActions.old).toMatchObject({
      action: 'delete',
      phase: 'prepared',
      bookmark: OPERATIONAL_STATE.bookmarks.old,
    });
    expect(background.getState().cleared).toEqual({});

    resolveDelete({ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } });
    await done;
  });

  it('clears the prepared intent when X rejects the delete', async () => {
    const background = await loadOperationalBackground({
      pageRequest: vi.fn().mockResolvedValue({ ok: false, status: 422, error: 'delete failed' }),
    });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toMatchObject({ ok: false, error: 'delete failed' });

    expect(background.getState().pendingActions).toEqual({});
    expect(background.getState().cleared).toEqual({});
    expect(background.getState().bookmarks).toEqual(OPERATIONAL_STATE.bookmarks);
  });

  it('clears the prepared intent when no X tab is available before request construction', async () => {
    const pageRequest = vi.fn();
    const background = await loadOperationalBackground({ pageRequest });

    await expect(background.invoke(
      { type: 'XBI_ACTION', action: 'done', tweetId: 'old' },
      {},
    )).resolves.toMatchObject({ ok: false, error: 'Open x.com in the active tab' });

    expect(pageRequest).not.toHaveBeenCalled();
    expect(background.getState().pendingActions).toEqual({});
  });

  it('clears the prepared intent when auth capture fails before dispatch', async () => {
    const pageRequest = vi.fn();
    const background = await loadOperationalBackground({ pageRequest, pageAuth: null });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toMatchObject({ ok: false, error: 'X session auth not captured; reload x.com' });

    expect(pageRequest).not.toHaveBeenCalled();
    expect(background.getState().pendingActions).toEqual({});
  });

  it('clears the prepared intent when mutation request construction fails before dispatch', async () => {
    const pageRequest = vi.fn();
    const initialState = structuredClone(OPERATIONAL_STATE);
    delete initialState.auth.queryIds.DeleteBookmark;
    const pageAuth = structuredClone(SESSION_AUTH);
    delete pageAuth.queryIds.DeleteBookmark;
    delete pageAuth.operationTemplates.DeleteBookmark;
    const background = await loadOperationalBackground({ pageRequest, pageAuth, initialState });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toMatchObject({ ok: false, error: 'X auth capture incomplete' });

    expect(pageRequest).not.toHaveBeenCalled();
    expect(background.getState().pendingActions).toEqual({});
  });

  it('retains reconciliation intent when the request outcome is uncertain after dispatch', async () => {
    const pageRequest = vi.fn().mockResolvedValue(undefined);
    const background = await loadOperationalBackground({ pageRequest });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toEqual({
        ok: true,
        recovery: true,
        reconciliationPending: true,
        undoUntil: expect.any(Number),
        warning: 'Delete outcome uncertain; Undo safely restores the bookmark',
      });

    expect(pageRequest).toHaveBeenCalledOnce();
    expect(background.getState().pendingActions.old).toMatchObject({
      action: 'delete',
      phase: 'reconciliation',
      undoUntil: expect.any(Number),
    });
    expect(background.getSession().pendingUndo.old).toMatchObject({
      undoUntil: expect.any(Number),
      bookmark: OPERATIONAL_STATE.bookmarks.old,
    });
    expect(background.getState().cleared.old).toMatchObject({ action: 'reconciliation' });
    expect(countLeft(background.getState().bookmarks, background.getState().cleared)).toBe(1);
  });

  it.each([0, 408, 409, 425, 429, 500, 503])(
    'retains bounded reconciliation for ambiguous or retryable HTTP status %s',
    async (status) => {
      const background = await loadOperationalBackground({
        pageRequest: vi.fn().mockResolvedValue({ ok: false, status, error: `status ${status}` }),
      });

      await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
        .resolves.toMatchObject({
          ok: true,
          recovery: true,
          reconciliationPending: true,
          undoUntil: expect.any(Number),
        });
      expect(background.getState().pendingActions.old).toMatchObject({
        phase: 'reconciliation',
        undoUntil: expect.any(Number),
      });
      expect(background.getSession().pendingUndo.old).toMatchObject({ undoUntil: expect.any(Number) });
    },
  );

  it.each([400, 401, 403, 404, 410, 422])(
    'clears intent for definite non-retryable HTTP rejection %s',
    async (status) => {
      const background = await loadOperationalBackground({
        pageRequest: vi.fn().mockResolvedValue({ ok: false, status, error: `status ${status}` }),
      });

      await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
        .resolves.toMatchObject({ ok: false, status });
      expect(background.getState().pendingActions).toEqual({});
      expect(background.getSession()).toEqual({});
    },
  );

  it('restores an unexpired Undo authorization after a service-worker restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const stores = { local: structuredClone(OPERATIONAL_STATE), session: {} };
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const firstWorker = await loadOperationalBackground({ pageRequest, stores });

    const done = await firstWorker.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    expect(done).toEqual({ ok: true, undoUntil: Date.now() + 6_000 });

    vi.resetModules();
    const restartedWorker = await loadOperationalBackground({ pageRequest, stores });

    await expect(restartedWorker.invoke({ type: 'XBI_GET_STATE' })).resolves.toMatchObject({
      pendingUndo: {
        old: { undoUntil: done.undoUntil },
      },
    });

    await expect(restartedWorker.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(pageRequest.mock.calls.map(([request]) => request.url.split('/').at(-1)))
      .toEqual(['DeleteBookmark', 'CreateBookmark']);
  });

  it('installs a replacement timer for rehydrated Undo and cleans session/local recovery at expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const undoUntil = Date.now() + 6_000;
    const intent = {
      action: 'delete',
      phase: 'deleted',
      requestedAt: new Date().toISOString(),
      bookmark: OPERATIONAL_STATE.bookmarks.old,
      recovery: false,
      undoUntil,
    };
    const stores = {
      local: {
        ...structuredClone(OPERATIONAL_STATE),
        cleared: { old: { action: 'done', at: intent.requestedAt } },
        pendingActions: { old: intent },
      },
      session: {
        pendingUndo: {
          old: { undoUntil, bookmark: OPERATIONAL_STATE.bookmarks.old },
        },
      },
    };
    const background = await loadOperationalBackground({ pageRequest: vi.fn(), stores });
    await background.invoke({ type: 'XBI_GET_STATE' });

    await vi.advanceTimersByTimeAsync(6_001);

    expect(background.getSession()).toEqual({});
    expect(background.getState().pendingActions).toEqual({});
    expect(background.getState().cleared.old.action).toBe('done');
  });

  it('removes expired rehydrated reconciliation instead of granting another window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const expiredAt = Date.now() - 1;
    const intent = {
      action: 'delete',
      phase: 'reconciliation',
      requestedAt: new Date(Date.now() - 10_000).toISOString(),
      bookmark: OPERATIONAL_STATE.bookmarks.old,
      undoUntil: expiredAt,
    };
    const stores = {
      local: {
        ...structuredClone(OPERATIONAL_STATE),
        cleared: { old: { action: 'done', at: intent.requestedAt, reconciliation: true } },
        pendingActions: { old: intent },
      },
      session: {
        pendingUndo: {
          old: { undoUntil: expiredAt, bookmark: OPERATIONAL_STATE.bookmarks.old },
        },
      },
    };
    const background = await loadOperationalBackground({ pageRequest: vi.fn(), stores });

    await expect(background.invoke({ type: 'XBI_GET_STATE' })).resolves.toMatchObject({
      pendingUndo: {},
      pendingActions: {},
    });
    expect(background.getSession()).toEqual({});
  });

  it('retains reconciliation and Undo when local publication fails after X deletes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const stores = { local: structuredClone(OPERATIONAL_STATE), session: {} };
    let failPublication = true;
    const setImplementation = vi.fn(async (patch) => {
      if (failPublication && patch.cleared) {
        failPublication = false;
        throw new Error('local publication failed');
      }
    });
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const firstWorker = await loadOperationalBackground({
      pageRequest,
      setImplementation,
      stores,
    });

    await expect(firstWorker.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' }))
      .resolves.toEqual({
        ok: true,
        recovery: true,
        undoUntil: Date.now() + 6_000,
        warning: 'Bookmark removed; local state recovery pending',
      });
    expect(stores.local.pendingActions.old.phase).toBe('prepared');
    expect(stores.session.pendingUndo.old).toMatchObject({
      undoUntil: Date.now() + 6_000,
      bookmark: OPERATIONAL_STATE.bookmarks.old,
    });

    vi.resetModules();
    const restartedWorker = await loadOperationalBackground({ pageRequest, stores });
    await expect(restartedWorker.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(restartedWorker.getState().pendingActions).toEqual({});
    expect(restartedWorker.getState().bookmarks.old).toEqual(OPERATIONAL_STATE.bookmarks.old);
  });

  it('expires the original prepared intent from a remote-success recovery response', async () => {
    vi.useFakeTimers();
    let failPublication = true;
    const setImplementation = vi.fn(async (patch) => {
      if (failPublication && patch.cleared) {
        failPublication = false;
        throw new Error('local publication failed');
      }
    });
    const background = await loadOperationalBackground({
      pageRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        payload: { data: { tweet_bookmark_delete: 'Done' } },
      }),
      setImplementation,
    });

    const result = await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.advanceTimersByTimeAsync(result.undoUntil - Date.now() + 1);

    expect(background.getSession()).toEqual({});
    expect(background.getState().pendingActions).toEqual({});
  });

  it('recovers a prepared intent when session authorization persistence fails after X deletes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const stores = { local: structuredClone(OPERATIONAL_STATE), session: {} };
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const firstWorker = await loadOperationalBackground({
      pageRequest,
      sessionSetImplementation: vi.fn().mockRejectedValue(new Error('session storage failed')),
      stores,
    });

    const result = await firstWorker.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    expect(result).toEqual({
      ok: true,
      recovery: true,
      undoUntil: Date.now() + 6_000,
      warning: 'Bookmark removed; session recovery persisted locally',
    });
    expect(stores.session).toEqual({});
    expect(stores.local.pendingActions.old).toMatchObject({
      phase: 'reconciliation',
      undoUntil: result.undoUntil,
    });
    expect(stores.local.cleared.old).toMatchObject({ action: 'done', reconciliation: true });

    vi.resetModules();
    const restartedWorker = await loadOperationalBackground({ pageRequest, stores });
    const recoveredState = await restartedWorker.invoke({ type: 'XBI_GET_STATE' });
    expect(recoveredState.cleared.old).toMatchObject({ action: 'done', reconciliation: true });
    expect(recoveredState.pendingActions.old.phase).toBe('reconciliation');

    await expect(restartedWorker.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(restartedWorker.getState().cleared.old).toBeUndefined();
  });

  it('reinserts the snapshotted bookmark when sync removes it before Undo', async () => {
    vi.useFakeTimers();
    const pageRequest = vi.fn(async (request) => {
      if (request.url.endsWith('/DeleteBookmark')) {
        return { ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } };
      }
      if (request.url.endsWith('/CreateBookmark')) {
        return { ok: true, status: 200, payload: { data: { tweet_bookmark_put: 'Done' } } };
      }
      return { ok: true, status: 200, payload: bookmarkPayload([]) };
    });
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });

    await expect(background.invoke({ type: 'XBI_SYNC' })).resolves.toEqual({ ok: true, total: 0 });
    expect(background.getState().bookmarks).toEqual({});

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(background.getState().bookmarks.old).toEqual(OPERATIONAL_STATE.bookmarks.old);
    expect(background.getState().cleared.old).toBeUndefined();
  });

  it('does not call X for an expired Undo and retains the Done marker', async () => {
    vi.useFakeTimers();
    const pageRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { data: { tweet_bookmark_delete: 'Done' } },
    });
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.advanceTimersByTimeAsync(6_001);

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: false, error: 'Undo window expired' });
    expect(pageRequest).toHaveBeenCalledOnce();
    expect(background.getState().cleared.old.action).toBe('done');
  });

  it('retains Done and permits retry when CreateBookmark fails', async () => {
    vi.useFakeTimers();
    const pageRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } })
      .mockResolvedValueOnce({ ok: false, status: 503, error: 'restore failed' })
      .mockResolvedValueOnce({ ok: true, status: 200, payload: { data: { tweet_bookmark_put: 'Done' } } });
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toMatchObject({ ok: false, error: 'restore failed' });
    expect(background.getState().cleared.old.action).toBe('done');
    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
    expect(background.getState().cleared.old).toBeUndefined();
  });

  it('does not let an old expiry timer erase a newer Undo window', async () => {
    vi.useFakeTimers();
    const pageRequest = vi.fn(async (request) => ({
      ok: true,
      status: 200,
      payload: request.url.endsWith('/DeleteBookmark')
        ? { data: { tweet_bookmark_delete: 'Done' } }
        : { data: { tweet_bookmark_put: 'Done' } },
    }));
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' });
    await vi.advanceTimersByTimeAsync(1_000);
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' }))
      .resolves.toEqual({ ok: true });
  });

  it('does not let an old timer clear a newer prepared intent before its request completes', async () => {
    vi.useFakeTimers();
    let resolveSecondDelete;
    const pageRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: { data: { tweet_bookmark_delete: 'Done' } },
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondDelete = resolve; }));
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    const firstRequestedAt = background.getState().pendingActions.old.requestedAt;
    await vi.advanceTimersByTimeAsync(5_900);

    const secondDone = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledTimes(2));
    const secondRequestedAt = background.getState().pendingActions.old.requestedAt;
    expect(secondRequestedAt).not.toBe(firstRequestedAt);

    await vi.advanceTimersByTimeAsync(101);

    expect(background.getState().pendingActions.old).toMatchObject({
      phase: 'prepared',
      requestedAt: secondRequestedAt,
    });
    resolveSecondDelete({
      ok: true,
      status: 200,
      payload: { data: { tweet_bookmark_delete: 'Done' } },
    });
    await expect(secondDone).resolves.toMatchObject({ ok: true, undoUntil: expect.any(Number) });
  });

  it('starts the full 6-second Undo window after a queued local publication completes', async () => {
    vi.useFakeTimers();
    let releasePublication;
    const setImplementation = vi.fn((patch) => (
      patch.cleared
        ? new Promise((resolve) => { releasePublication = resolve; })
        : Promise.resolve()
    ));
    const pageRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { data: { tweet_bookmark_delete: 'Done' } },
    });
    const background = await loadOperationalBackground({ pageRequest, setImplementation });
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(releasePublication).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(7_000);
    releasePublication();

    await expect(done).resolves.toEqual({ ok: true, undoUntil: Date.now() + 6_000 });
  });

  it('coalesces concurrent Done requests for the same bookmark', async () => {
    let resolveDelete;
    const pageRequest = vi.fn(() => new Promise((resolve) => { resolveDelete = resolve; }));
    const background = await loadOperationalBackground({ pageRequest });
    const first = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    const second = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    resolveDelete({ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } });

    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(pageRequest).toHaveBeenCalledOnce();
    expect(background.set.mock.calls.filter(([patch]) => patch.cleared)).toHaveLength(1);
  });

  it('rejects queued Keep after Done and preserves the Done marker and count', async () => {
    vi.useFakeTimers();
    let resolveDelete;
    const pageRequest = vi.fn(() => new Promise((resolve) => { resolveDelete = resolve; }));
    const background = await loadOperationalBackground({ pageRequest });
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    const keep = background.invoke({ type: 'XBI_ACTION', action: 'keep', tweetId: 'old' });
    resolveDelete({ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } });

    const [doneResult, keepResult] = await Promise.all([done, keep]);

    expect(doneResult.ok).toBe(true);
    expect(keepResult).toEqual({ ok: false, error: 'Bookmark is already Done', status: 0 });
    expect(pageRequest.mock.calls.map(([request]) => request.url.split('/').at(-1)))
      .toEqual(['DeleteBookmark']);
    const state = background.getState();
    expect(state.cleared.old.action).toBe('done');
    expect(countLeft(state.bookmarks, state.cleared)).toBe(0);
  });

  it('orders concurrent Done then Undo as DeleteBookmark then CreateBookmark', async () => {
    vi.useFakeTimers();
    let resolveDelete;
    const pageRequest = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = resolve; }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: { data: { tweet_bookmark_put: 'Done' } },
      });
    const background = await loadOperationalBackground({ pageRequest });
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    const undo = background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' });
    resolveDelete({ ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } });

    await Promise.all([done, undo]);

    expect(pageRequest.mock.calls.map(([request]) => request.url.split('/').at(-1)))
      .toEqual(['DeleteBookmark', 'CreateBookmark']);
    expect(background.getState().cleared.old).toBeUndefined();
  });

  it('orders concurrent Undo then Done as CreateBookmark then DeleteBookmark', async () => {
    vi.useFakeTimers();
    let resolveCreate;
    const pageRequest = vi.fn(async (request) => {
      if (request.url.endsWith('/CreateBookmark')) {
        return new Promise((resolve) => { resolveCreate = resolve; });
      }
      return { ok: true, status: 200, payload: { data: { tweet_bookmark_delete: 'Done' } } };
    });
    const background = await loadOperationalBackground({ pageRequest });
    await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    const undo = background.invoke({ type: 'XBI_ACTION', action: 'undo', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledTimes(2));
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    resolveCreate({ ok: true, status: 200, payload: { data: { tweet_bookmark_put: 'Done' } } });

    await Promise.all([undo, done]);

    expect(pageRequest.mock.calls.map(([request]) => request.url.split('/').at(-1)))
      .toEqual(['DeleteBookmark', 'CreateBookmark', 'DeleteBookmark']);
    expect(background.getState().cleared.old.action).toBe('done');
  });

  it('serializes concurrent local actions so cleared markers cannot overwrite each other', async () => {
    const initialState = {
      ...OPERATIONAL_STATE,
      bookmarks: {
        old: OPERATIONAL_STATE.bookmarks.old,
        other: { id: 'other', text: 'other cache', saveRank: 2 },
      },
    };
    const background = await loadOperationalBackground({ pageRequest: vi.fn(), initialState });

    await Promise.all([
      background.invoke({ type: 'XBI_ACTION', action: 'keep', tweetId: 'old' }),
      background.invoke({ type: 'XBI_ACTION', action: 'keep', tweetId: 'other' }),
    ]);

    expect(background.getState().cleared).toMatchObject({
      old: { action: 'keep' },
      other: { action: 'keep' },
    });
    expect(background.sendMessage).not.toHaveBeenCalled();
  });

  it('merges an allowed settings field patch without dropping other settings', async () => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn() });

    await expect(background.invoke({
      type: 'XBI_UPDATE_SETTINGS',
      patch: { confirmRealDelete: false },
    })).resolves.toEqual({ ok: true });

    expect(background.getState().settings).toEqual({
      ...OPERATIONAL_STATE.settings,
      confirmRealDelete: false,
    });
  });

  it('serializes a settings patch behind Done so deleteConfirmed is not overwritten', async () => {
    let releaseDoneWrite;
    const setImplementation = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseDoneWrite = resolve; }))
      .mockResolvedValue(undefined);
    const background = await loadOperationalBackground({
      pageRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        payload: { data: { tweet_bookmark_delete: 'Done' } },
      }),
      setImplementation,
    });
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(setImplementation).toHaveBeenCalledOnce());

    const settings = background.invoke({
      type: 'XBI_UPDATE_SETTINGS',
      patch: { confirmRealDelete: false },
    });
    releaseDoneWrite();
    await Promise.all([done, settings]);

    expect(background.getState().settings).toMatchObject({
      confirmRealDelete: false,
      deleteConfirmed: true,
      keepCooldownHours: 72,
    });
  });

  it.each([
    undefined,
    {},
    { confirmRealDelete: 'false' },
    { deleteConfirmed: true },
    { confirmRealDelete: true, unknown: true },
  ])('rejects an invalid settings patch without writing: %j', async (patch) => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn() });

    await expect(background.invoke({ type: 'XBI_UPDATE_SETTINGS', patch }))
      .resolves.toEqual({ ok: false, error: 'Invalid settings patch' });
    expect(background.set).not.toHaveBeenCalled();
  });

  it('rejects malformed actions before reading state or contacting X', async () => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn() });

    await expect(background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: undefined }))
      .resolves.toEqual({ ok: false, error: 'Invalid bookmark action' });
    await expect(background.invoke({ type: 'XBI_ACTION', action: 'destroy', tweetId: 'old' }))
      .resolves.toEqual({ ok: false, error: 'Invalid bookmark action' });
    expect(background.sendMessage).not.toHaveBeenCalled();
    expect(background.set).not.toHaveBeenCalled();
  });
});
