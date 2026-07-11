import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  constructor(attributes = {}, textContent = '', tagName = 'div') {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.disabled = false;
    this.eventListeners = new Map();
    this.hidden = false;
    this.id = '';
    this.innerHTML = '';
    this.parentElement = null;
    this.style = { cssText: '' };
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.type = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...children) {
    for (const child of children) {
      if (typeof child === 'string') {
        this.textContent += child;
        continue;
      }
      child.remove();
      this.children.push(child);
      child.parentElement = this;
    }
  }

  addEventListener(type, handler) {
    this.eventListeners.set(type, handler);
  }

  insertBefore(child, reference) {
    child.remove();
    const index = this.children.indexOf(reference);
    if (index < 0) throw new Error('Reference is not a child');
    this.children.splice(index, 0, child);
    child.parentElement = this;
  }

  replaceChild(child, replaced) {
    const index = this.children.indexOf(replaced);
    if (index < 0) throw new Error('Replaced node is not a child');
    child.remove();
    this.children[index] = child;
    child.parentElement = this;
    replaced.parentElement = null;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index - 1] ?? null;
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[data-testid="primaryColumn"]') return this.attributes.get('data-testid') === 'primaryColumn';
    if (selector === '[aria-label^="Timeline"]') return this.attributes.get('aria-label')?.startsWith('Timeline') ?? false;
    if (selector === '[data-testid="cellInnerDiv"]') return this.attributes.get('data-testid') === 'cellInnerDiv';
    if (selector === '[role="tab"][aria-selected="true"]') {
      return this.attributes.get('role') === 'tab' && this.attributes.get('aria-selected') === 'true';
    }
    return false;
  }

  findAll(tagName) {
    return this.children.flatMap((child) => [
      ...(child.tagName === tagName.toUpperCase() ? [child] : []),
      ...child.findAll(tagName),
    ]);
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function makeTimeline(label = 'Timeline: Your Home Timeline') {
  const timeline = new FakeElement({ 'aria-label': label });
  timeline.append(new FakeElement({ 'data-testid': 'cellInnerDiv' }));
  timeline.append(new FakeElement({ 'data-testid': 'cellInnerDiv' }));
  return timeline;
}

function makeFixture() {
  const body = new FakeElement();
  const decoyTimeline = makeTimeline('Timeline: Trending');
  const primaryColumn = new FakeElement({ 'data-testid': 'primaryColumn' });
  const tabs = new FakeElement();
  const forYouTab = new FakeElement({ role: 'tab', 'aria-selected': 'true' }, 'For you');
  const followingTab = new FakeElement({ role: 'tab', 'aria-selected': 'false' }, 'Following');
  const timeline = makeTimeline();
  tabs.append(forYouTab);
  tabs.append(followingTab);
  primaryColumn.append(tabs);
  primaryColumn.append(timeline);
  body.append(decoyTimeline);
  body.append(primaryColumn);

  const document = {
    body,
    createElement: (tag) => new FakeElement({}, '', tag),
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (selector) => body.querySelector(selector),
  };
  return { body, decoyTimeline, document, followingTab, forYouTab, primaryColumn, timeline };
}

const TEST_STATE = {
  bookmarks: {
    '1806': {
      id: '1806',
      url: 'https://x.com/zarazhangrui/status/1806',
      text: 'I hoard X bookmarks and never read them.',
      author: 'Zara Zhang',
      handle: '@zarazhangrui',
      avatar: '',
      createdAt: '2026-06-21T13:37:00Z',
      media: [],
      saveRank: 1,
    },
  },
  cleared: {},
  meta: { total: 1, lastSync: '2999-01-01T00:00:00.000Z', syncStatus: 'idle' },
  settings: { keepCooldownHours: 72, confirmRealDelete: true, deleteConfirmed: false },
};

const BOOKMARKS_PAGE_REQUEST = {
  url: 'https://x.com/i/api/graphql/read123/Bookmarks',
  init: {
    method: 'GET',
    credentials: 'include',
    headers: {
      authorization: 'Bearer session',
      'x-csrf-token': 'csrf-session',
    },
  },
};

async function loadContent(options = {}) {
  const fixture = makeFixture();
  options.configureFixture?.(fixture);
  const location = { pathname: '/home' };
  const storageGet = options.storageGet ?? vi.fn().mockResolvedValue(TEST_STATE);
  const sendMessage = options.sendMessage ?? vi.fn().mockResolvedValue({ ok: true });
  const confirm = options.confirm ?? vi.fn().mockReturnValue(true);
  let mutationCallback;
  let observerOptions;
  let intervalCallback;
  let frameCallback;
  let runtimeMessageCallback;
  let storageChangedCallback;
  let windowMessageCallback;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const requestAnimationFrame = vi.fn((callback) => {
    frameCallback ??= callback;
    return 1;
  });
  const runFrame = async () => {
    const callback = frameCallback;
    frameCallback = null;
    callback?.();
    await flush();
  };

  vi.stubGlobal('document', fixture.document);
  vi.stubGlobal('location', location);
  const runtime = {
    sendMessage,
    onMessage: {
      addListener: vi.fn((listener) => { runtimeMessageCallback = listener; }),
    },
  };
  vi.stubGlobal('chrome', {
    runtime,
    storage: {
      local: { get: storageGet },
      onChanged: { addListener: vi.fn((listener) => { storageChangedCallback = listener; }) },
    },
  });
  const pageWindow = {
    confirm,
    open: vi.fn(),
    postMessage: vi.fn(),
    addEventListener: vi.fn((type, listener) => {
      if (type === 'message') windowMessageCallback = listener;
    }),
  };
  vi.stubGlobal('window', pageWindow);
  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  vi.stubGlobal('MutationObserver', class {
    constructor(callback) {
      mutationCallback = callback;
    }
    observe(_target, options) {
      observerOptions = options;
    }
  });
  vi.stubGlobal('setInterval', (callback) => {
    intervalCallback = callback;
    return 1;
  });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await import('../src/content.js');
  await flush();

  return {
    ...fixture,
    confirm,
    flush,
    interval: async () => { intervalCallback(); await flush(); },
    invokeRuntime: (message) => {
      const sendResponse = vi.fn();
      return {
        returned: runtimeMessageCallback(message, {}, sendResponse),
        sendResponse,
      };
    },
    location,
    mutate: async () => { mutationCallback(); await runFrame(); },
    mutateBurst: async (count) => {
      for (let index = 0; index < count; index += 1) mutationCallback();
      const scheduled = requestAnimationFrame.mock.calls.length;
      await runFrame();
      return scheduled;
    },
    observerOptions,
    requestAnimationFrame,
    pageWindow,
    pageMessage: (data, source = pageWindow) => windowMessageCallback({ data, source }),
    sendMessage,
    storageGet,
    storageChanged: async (changes, area = 'local') => {
      storageChangedCallback(changes, area);
      await flush();
    },
  };
}

describe('bookmark card injection', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('inserts one card before the first cell of the primary-column timeline', async () => {
    const { body, decoyTimeline, storageGet, timeline } = await loadContent();

    expect(timeline.children[0].id).toBe('xbi-card');
    expect(timeline.children[0].tagName).toBe('ARTICLE');
    expect(timeline.children[0].findAll('strong').some((node) => node.textContent === 'Zara Zhang')).toBe(true);
    expect(decoyTimeline.children.some((child) => child.id === 'xbi-card')).toBe(false);
    expect(body.querySelectorAll('#xbi-card')).toHaveLength(1);
    expect(storageGet).toHaveBeenCalledOnce();
  });

  it('shows a status card only when a non-empty cached backlog is fully done', async () => {
    const state = {
      ...TEST_STATE,
      cleared: { '1806': { action: 'done', at: '2026-07-11T00:00:00.000Z' } },
    };
    const fixture = await loadContent({ storageGet: vi.fn().mockResolvedValue(state) });
    const card = fixture.document.getElementById('xbi-card');

    expect(fixture.timeline.children[0]).toBe(card);
    expect(card.findAll('strong')[0].textContent).toBe('Backlog cleared ✓');
    expect(card.findAll('div')[0].textContent).toBe('No saved bookmarks left to resurface.');
    expect(card.findAll('button')).toHaveLength(0);
  });

  it('does not show completion when an all-Done cache has a sync error', async () => {
    const state = {
      ...TEST_STATE,
      cleared: { '1806': { action: 'done', at: '2026-07-11T00:00:00.000Z' } },
      meta: {
        ...TEST_STATE.meta,
        syncStatus: 'error',
        syncError: 'X session auth not captured; reload x.com',
      },
    };
    const fixture = await loadContent({ storageGet: vi.fn().mockResolvedValue(state) });

    expect(fixture.document.getElementById('xbi-card')).toBeNull();
  });

  it.each([
    ['an empty cache', { ...TEST_STATE, bookmarks: {}, meta: { ...TEST_STATE.meta, total: 0 } }],
    ['a sync/login error with no cache', {
      ...TEST_STATE,
      bookmarks: {},
      meta: { ...TEST_STATE.meta, total: 0, syncStatus: 'error', syncError: 'X session auth not captured; reload x.com' },
    }],
  ])('does not inject feed status for %s', async (_label, state) => {
    const fixture = await loadContent({ storageGet: vi.fn().mockResolvedValue(state) });

    expect(fixture.document.getElementById('xbi-card')).toBeNull();
  });

  it('deduplicates and restores first position after mutations and timeline replacement', async () => {
    const fixture = await loadContent();
    const card = fixture.document.getElementById('xbi-card');
    fixture.timeline.append(card);

    await fixture.mutate();
    expect(fixture.timeline.children[0]).toBe(card);
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);

    const replacement = makeTimeline();
    fixture.primaryColumn.replaceChild(replacement, fixture.timeline);
    await fixture.mutate();
    expect(replacement.children[0].id).toBe('xbi-card');
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);
    expect(fixture.storageGet).toHaveBeenCalledOnce();
  });

  it('coalesces mutation bursts into one reposition pass', async () => {
    const fixture = await loadContent();
    const card = fixture.document.getElementById('xbi-card');
    fixture.timeline.append(card);

    const scheduled = await fixture.mutateBurst(3);

    expect(scheduled).toBe(1);
    expect(fixture.timeline.children[0]).toBe(card);
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);
  });

  it('removes on navigation and restores on return to Home', async () => {
    const fixture = await loadContent();
    fixture.location.pathname = '/profile';
    await fixture.interval();
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    fixture.location.pathname = '/home';
    await fixture.interval();
    expect(fixture.timeline.children[0].id).toBe('xbi-card');
    expect(fixture.storageGet).toHaveBeenCalledTimes(2);
  });

  it('removes on Following and restores on For You without a pathname change', async () => {
    const fixture = await loadContent();
    fixture.forYouTab.setAttribute('aria-selected', 'false');
    fixture.followingTab.setAttribute('aria-selected', 'true');
    await fixture.mutate();
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    fixture.followingTab.setAttribute('aria-selected', 'false');
    fixture.forYouTab.setAttribute('aria-selected', 'true');
    await fixture.mutate();
    expect(fixture.timeline.children[0].id).toBe('xbi-card');
    expect(fixture.storageGet).toHaveBeenCalledOnce();
    expect(fixture.observerOptions).toMatchObject({ attributes: true, attributeFilter: ['aria-selected'] });
  });

  it('ignores a stale load from an earlier Home visit', async () => {
    let resolveFirstLoad;
    const storageGet = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstLoad = resolve; }))
      .mockResolvedValue(TEST_STATE);
    const fixture = await loadContent({ storageGet });

    fixture.location.pathname = '/profile';
    await fixture.interval();
    fixture.location.pathname = '/home';
    await fixture.interval();
    const currentCard = fixture.document.getElementById('xbi-card');

    resolveFirstLoad(TEST_STATE);
    await fixture.flush();

    expect(fixture.document.getElementById('xbi-card')).toBe(currentCard);
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);
    expect(storageGet).toHaveBeenCalledTimes(2);
  });

  it('retries after loading state fails', async () => {
    const storageGet = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(TEST_STATE);
    const fixture = await loadContent({ storageGet });

    expect(fixture.document.getElementById('xbi-card')).toBeNull();
    await fixture.mutate();

    expect(fixture.document.getElementById('xbi-card')).not.toBeNull();
    expect(storageGet).toHaveBeenCalledTimes(2);
  });

  it('retries after building the card fails', async () => {
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    const fixture = await loadContent({
      configureFixture: ({ document }) => {
        const createElement = document.createElement;
        let failArticle = true;
        document.createElement = (tag) => {
          if (tag === 'article' && failArticle) {
            failArticle = false;
            throw new Error('render failed');
          }
          return createElement(tag);
        };
      },
    });

    expect(fixture.document.getElementById('xbi-card')).toBeNull();
    await fixture.mutate();

    expect(fixture.document.getElementById('xbi-card')).not.toBeNull();
    expect(fixture.storageGet).toHaveBeenCalledOnce();
    expect(rng).toHaveBeenCalledOnce();
  });

  it('sends keep and confirmed done actions and dismisses the card', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, undoUntil: Date.now() + 6_000 });
    const fixture = await loadContent({ sendMessage });
    const buttons = fixture.document.getElementById('xbi-card').findAll('button');

    await buttons[0].eventListeners.get('click')();
    expect(fixture.sendMessage).toHaveBeenCalledWith({ type: 'XBI_ACTION', action: 'keep', tweetId: '1806' });
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    fixture.location.pathname = '/profile';
    await fixture.interval();
    fixture.location.pathname = '/home';
    await fixture.interval();
    const doneButton = fixture.document.getElementById('xbi-card').findAll('button')[1];
    await doneButton.eventListeners.get('click')();

    expect(fixture.confirm).toHaveBeenCalledWith('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
    expect(fixture.sendMessage).toHaveBeenLastCalledWith({ type: 'XBI_ACTION', action: 'done', tweetId: '1806' });
    expect(fixture.document.getElementById('xbi-card')).toBeNull();
  });

  it('keeps the card and announces unsuccessful and rejected runtime actions', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'X did not confirm the action.' })
      .mockRejectedValueOnce(new Error('runtime unavailable'));
    const fixture = await loadContent({ sendMessage });
    const card = fixture.document.getElementById('xbi-card');
    const buttons = card.findAll('button');
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await buttons[0].eventListeners.get('click')();
    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(status.textContent).toBe('X did not confirm the action.');

    await buttons[1].eventListeners.get('click')();
    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');
    expect(buttons.every((button) => !button.disabled)).toBe(true);
  });

  it('does not dismiss for a truthy but malformed runtime response', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: 1 });
    const fixture = await loadContent({ sendMessage });
    const card = fixture.document.getElementById('xbi-card');
    const keepButton = card.findAll('button')[0];
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await keepButton.eventListeners.get('click')();

    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');
  });

  it('fails closed when Done success omits its validated Undo window', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const fixture = await loadContent({ sendMessage });
    const card = fixture.document.getElementById('xbi-card');
    const doneButton = card.findAll('button')[1];
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await doneButton.eventListeners.get('click')();

    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');
  });

  it('offers Undo for 6 seconds and sends CreateBookmark through the background action', async () => {
    const undoUntil = Date.now() + 6_000;
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, undoUntil })
      .mockResolvedValueOnce({ ok: true });
    const fixture = await loadContent({ sendMessage });
    vi.useFakeTimers();
    const doneButton = fixture.document.getElementById('xbi-card').findAll('button')[1];

    await doneButton.eventListeners.get('click')();
    const toast = fixture.document.getElementById('xbi-undo');
    const undoButton = toast.findAll('button')[0];
    const firstClick = undoButton.eventListeners.get('click')();
    const secondClick = undoButton.eventListeners.get('click')();
    await Promise.all([firstClick, secondClick]);

    expect(sendMessage.mock.calls).toEqual([
      [{ type: 'XBI_ACTION', action: 'done', tweetId: '1806' }],
      [{ type: 'XBI_ACTION', action: 'undo', tweetId: '1806' }],
    ]);
    expect(toast.textContent).toBe('Bookmark restored');
    await vi.advanceTimersByTimeAsync(1_200);
    expect(fixture.document.getElementById('xbi-undo')).toBeNull();
  });

  it('keeps the Undo toast visible with an error when restore fails', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, undoUntil: Date.now() + 6_000 })
      .mockResolvedValueOnce(undefined);
    const fixture = await loadContent({ sendMessage });
    const doneButton = fixture.document.getElementById('xbi-card').findAll('button')[1];
    await doneButton.eventListeners.get('click')();
    const toast = fixture.document.getElementById('xbi-undo');

    await toast.findAll('button')[0].eventListeners.get('click')();

    expect(toast.textContent).toBe('Undo failed');
  });

  it.each([
    [{ ...TEST_STATE, meta: { ...TEST_STATE.meta, lastSync: '2020-01-01T00:00:00.000Z' } }, 1],
    [{ ...TEST_STATE, meta: { ...TEST_STATE.meta, lastSync: null, syncStatus: 'syncing' } }, 0],
    [{ ...TEST_STATE, meta: { ...TEST_STATE.meta, lastSync: 'not-a-date' } }, 0],
  ])('automatically syncs only a valid stale idle cache', async (state, expectedSyncs) => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, total: 1 });
    await loadContent({ storageGet: vi.fn().mockResolvedValue(state), sendMessage });

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'XBI_SYNC')).toHaveLength(expectedSyncs);
  });

  it('renders after sync publication when the initial cache was empty', async () => {
    const empty = { ...TEST_STATE, bookmarks: {}, meta: { ...TEST_STATE.meta, total: 0 } };
    const storageGet = vi.fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValue(TEST_STATE);
    const fixture = await loadContent({ storageGet });
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    await fixture.storageChanged({ bookmarks: { oldValue: {}, newValue: TEST_STATE.bookmarks } });

    expect(fixture.document.getElementById('xbi-card')).not.toBeNull();
  });

  it('replaces completion status with an eligible bookmark after a successful sync', async () => {
    const completed = {
      ...TEST_STATE,
      cleared: { '1806': { action: 'done', at: '2026-07-11T00:00:00.000Z' } },
    };
    const storageGet = vi.fn()
      .mockResolvedValueOnce(completed)
      .mockResolvedValue(TEST_STATE);
    const fixture = await loadContent({ storageGet });
    const statusCard = fixture.document.getElementById('xbi-card');

    await fixture.storageChanged({
      bookmarks: { oldValue: completed.bookmarks, newValue: TEST_STATE.bookmarks },
      meta: { oldValue: completed.meta, newValue: TEST_STATE.meta },
    });

    const bookmarkCard = fixture.document.getElementById('xbi-card');
    expect(bookmarkCard).not.toBe(statusCard);
    expect(bookmarkCard.findAll('strong').some((node) => node.textContent === 'Zara Zhang')).toBe(true);
    expect(storageGet).toHaveBeenCalledTimes(2);
  });

  it('replaces completion status with the restored bookmark after Undo updates cleared state', async () => {
    const completed = {
      ...TEST_STATE,
      cleared: { '1806': { action: 'done', at: '2026-07-11T00:00:00.000Z' } },
    };
    const storageGet = vi.fn()
      .mockResolvedValueOnce(completed)
      .mockResolvedValue(TEST_STATE);
    const fixture = await loadContent({ storageGet });
    const statusCard = fixture.document.getElementById('xbi-card');

    await fixture.storageChanged({
      cleared: { oldValue: completed.cleared, newValue: TEST_STATE.cleared },
    });

    const bookmarkCard = fixture.document.getElementById('xbi-card');
    expect(bookmarkCard).not.toBe(statusCard);
    expect(bookmarkCard.findAll('strong').some((node) => node.textContent === 'Zara Zhang')).toBe(true);
    expect(storageGet).toHaveBeenCalledTimes(2);
  });

  it('preserves an ordinary random card across storage publications in the same visit', async () => {
    const fixture = await loadContent();
    const card = fixture.document.getElementById('xbi-card');

    await fixture.storageChanged({
      bookmarks: { oldValue: TEST_STATE.bookmarks, newValue: TEST_STATE.bookmarks },
      cleared: { oldValue: TEST_STATE.cleared, newValue: TEST_STATE.cleared },
      meta: { oldValue: TEST_STATE.meta, newValue: TEST_STATE.meta },
    });

    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(fixture.storageGet).toHaveBeenCalledOnce();
  });

  it('treats declined delete confirmation as explicit cancellation', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    const fixture = await loadContent({ confirm });
    const card = fixture.document.getElementById('xbi-card');
    const doneButton = card.findAll('button')[1];
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await doneButton.eventListeners.get('click')();

    expect(fixture.sendMessage).not.toHaveBeenCalled();
    expect(fixture.document.getElementById('xbi-card')).toBe(card);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
  });

  it('does not let a stale action response dismiss the next Home visit card', async () => {
    let resolveAction;
    const sendMessage = vi.fn(() => new Promise((resolve) => { resolveAction = resolve; }));
    const fixture = await loadContent({ sendMessage });
    const oldCard = fixture.document.getElementById('xbi-card');
    const action = oldCard.findAll('button')[0].eventListeners.get('click')();

    fixture.location.pathname = '/profile';
    await fixture.interval();
    fixture.location.pathname = '/home';
    await fixture.interval();
    const newCard = fixture.document.getElementById('xbi-card');

    resolveAction({ ok: true });
    await action;

    expect(newCard).not.toBe(oldCard);
    expect(fixture.document.getElementById('xbi-card')).toBe(newCard);
  });

  it('sanitizes page captures before retaining and forwarding session auth', async () => {
    const fixture = await loadContent();
    fixture.pageMessage({
      source: 'xbi-page',
      type: 'XBI_AUTH_CAPTURE',
      capture: {
        operation: 'Bookmarks',
        queryId: 'read123',
        bearer: 'Bearer session',
        csrf: 'csrf-session',
        operationHeaders: {
          'x-client-transaction-id': 'tx',
          cookie: 'drop-me',
        },
        operationTemplate: {
          method: 'GET',
          params: { variables: '{}', secret: 'drop-me' },
          body: null,
        },
      },
    });

    expect(fixture.sendMessage).toHaveBeenCalledWith({
      type: 'XBI_AUTH_CAPTURE',
      capture: {
        operation: 'Bookmarks',
        queryId: 'read123',
        bearer: 'Bearer session',
        csrf: 'csrf-session',
        operationHeaders: { 'x-client-transaction-id': 'tx' },
        operationTemplate: {
          method: 'GET',
          params: { variables: '{}' },
          body: null,
        },
      },
    });

    const auth = fixture.invokeRuntime({ type: 'XBI_GET_PAGE_AUTH' });
    expect(auth.returned).toBe(false);
    expect(auth.sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      bearer: 'Bearer session',
      csrf: 'csrf-session',
      queryIds: { Bookmarks: 'read123' },
    }));
  });

  it('correlates page responses and keeps the Chrome 114 async channel open', async () => {
    const fixture = await loadContent();
    const runtime = fixture.invokeRuntime({
      type: 'XBI_PAGE_REQUEST',
      request: BOOKMARKS_PAGE_REQUEST,
    });
    const executeMessage = fixture.pageWindow.postMessage.mock.calls.at(-1)[0];

    expect(runtime.returned).toBe(true);
    expect(executeMessage).toMatchObject({
      source: 'xbi-extension',
      type: 'XBI_EXECUTE',
      requestId: expect.any(String),
    });

    fixture.pageMessage({
      source: 'xbi-page',
      type: 'XBI_EXECUTE_RESULT',
      requestId: 'wrong-request',
      operation: 'Bookmarks',
      ok: true,
      status: 200,
    });
    expect(runtime.sendResponse).not.toHaveBeenCalled();

    fixture.pageMessage({
      source: 'xbi-page',
      type: 'XBI_EXECUTE_RESULT',
      requestId: executeMessage.requestId,
      operation: 'DeleteBookmark',
      ok: true,
      status: 200,
      payload: { data: {} },
    });
    fixture.pageMessage({
      source: 'xbi-page',
      type: 'XBI_EXECUTE_RESULT',
      requestId: executeMessage.requestId,
      operation: 'Bookmarks',
      ok: true,
      status: '200',
      payload: { data: {} },
    });
    expect(runtime.sendResponse).not.toHaveBeenCalled();

    const result = {
      source: 'xbi-page',
      type: 'XBI_EXECUTE_RESULT',
      requestId: executeMessage.requestId,
      operation: 'Bookmarks',
      ok: true,
      status: 200,
      payload: { data: {} },
    };
    fixture.pageMessage(result);
    await fixture.flush();
    expect(runtime.sendResponse).toHaveBeenCalledWith(result);
  });

  it('bounds an unanswered page request with a 20-second timeout', async () => {
    const fixture = await loadContent();
    vi.useFakeTimers();
    const runtime = fixture.invokeRuntime({
      type: 'XBI_PAGE_REQUEST',
      request: BOOKMARKS_PAGE_REQUEST,
    });

    expect(runtime.returned).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(runtime.sendResponse).toHaveBeenCalledWith({
      ok: false,
      status: 0,
      error: 'Page request timed out',
    });
  });

  it('rejects page requests outside the pending operation schema', async () => {
    const fixture = await loadContent();
    const unknownOperation = fixture.invokeRuntime({
      type: 'XBI_PAGE_REQUEST',
      request: {
        ...BOOKMARKS_PAGE_REQUEST,
        url: 'https://x.com/i/api/graphql/read123/UnknownOperation',
      },
    });
    const missingAuth = fixture.invokeRuntime({
      type: 'XBI_PAGE_REQUEST',
      request: {
        ...BOOKMARKS_PAGE_REQUEST,
        init: { method: 'GET', credentials: 'include', headers: {} },
      },
    });

    expect(unknownOperation.returned).toBe(false);
    expect(missingAuth.returned).toBe(false);
    expect(unknownOperation.sendResponse).toHaveBeenCalledWith({
      ok: false,
      status: 0,
      error: 'Invalid page request',
    });
    expect(missingAuth.sendResponse).toHaveBeenCalledWith({
      ok: false,
      status: 0,
      error: 'Invalid page request',
    });
    expect(fixture.pageWindow.postMessage).not.toHaveBeenCalled();
  });
});
