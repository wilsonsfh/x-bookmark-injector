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
    cardStyle: 'hybrid',
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
  initialState = OPERATIONAL_STATE,
  setImplementation = async () => {},
} = {}) {
  let listener;
  let state = structuredClone(initialState);
  const set = vi.fn(async (patch) => {
    await setImplementation(patch);
    state = { ...state, ...structuredClone(patch) };
  });
  const sendMessage = vi.fn(async (_tabId, message) => {
    if (message.type === 'XBI_GET_PAGE_AUTH') return structuredClone(SESSION_AUTH);
    if (message.type === 'XBI_PAGE_REQUEST') return pageRequest(message.request);
    return undefined;
  });
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: vi.fn((callback) => { listener = callback; }) } },
    storage: { local: { get: vi.fn(async () => structuredClone(state)), set } },
    tabs: { query: vi.fn(), sendMessage },
  });
  await import('../src/background.js');
  return {
    getState: () => structuredClone(state),
    sendMessage,
    set,
    invoke(message, sender = { tab: { id: 7 } }) {
      return new Promise((resolve) => {
        const returned = listener(message, sender, resolve);
        if (returned !== true) throw new Error('Expected async message channel');
      });
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
  ])('does not mark Done unless X returns a validated mutation success: %j', async (response, error) => {
    const background = await loadOperationalBackground({ pageRequest: vi.fn().mockResolvedValue(response) });

    const result = await background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(error) });
    expect(background.getState().cleared).toEqual({});
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

  it('starts the full 6-second Undo window after a queued local publication completes', async () => {
    vi.useFakeTimers();
    let releaseFirstWrite;
    const setImplementation = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirstWrite = resolve; }))
      .mockResolvedValue(undefined);
    const pageRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { data: { tweet_bookmark_delete: 'Done' } },
    });
    const background = await loadOperationalBackground({ pageRequest, setImplementation });
    const keep = background.invoke({ type: 'XBI_ACTION', action: 'keep', tweetId: 'other' });
    await vi.waitFor(() => expect(setImplementation).toHaveBeenCalledOnce());
    const done = background.invoke({ type: 'XBI_ACTION', action: 'done', tweetId: 'old' });
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(7_000);
    releaseFirstWrite();
    await keep;

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
