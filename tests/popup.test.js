import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  constructor(tagName = 'div') {
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.disabled = false;
    this.eventListeners = new Map();
    this.hidden = false;
    this.href = '';
    this.id = '';
    this.parentElement = null;
    this.ownerDocument = null;
    this.tagName = tagName.toUpperCase();
    this.type = '';
    this._textContent = '';
  }

  get textContent() {
    return this._textContent + this.children
      .map((child) => typeof child === 'string' ? child : child.textContent)
      .join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.eventListeners.get(type) ?? [];
    handlers.push(handler);
    this.eventListeners.set(type, handlers);
  }

  async dispatch(type, extra = {}) {
    if (type === 'click' && this.disabled) return;
    const event = { currentTarget: this, target: this, ...extra };
    await Promise.all((this.eventListeners.get(type) ?? []).map((handler) => handler(event)));
  }

  append(...children) {
    for (const child of children) {
      if (typeof child === 'string') {
        this.children.push(child);
        continue;
      }
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    if (this.children.some((child) => typeof child !== 'string' && child.contains(this.ownerDocument?.activeElement))) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    for (const child of this.children) {
      if (typeof child !== 'string') child.parentElement = null;
    }
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.ownerDocument?.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  contains(element) {
    return this === element || this.children.some((child) => typeof child !== 'string' && child.contains(element));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => {
      if (typeof child === 'string') return [];
      return [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const BASE_STATE = {
  bookmarks: {
    newer: {
      id: 'newer',
      url: 'https://x.com/newer/status/2',
      text: '<img src=x onerror=alert(1)>',
      author: 'Newer author',
      saveRank: 2,
    },
    oldest: {
      id: 'oldest',
      url: 'https://x.com/oldest/status/1',
      text: 'Oldest saved bookmark',
      handle: '@oldest',
      saveRank: 1,
    },
    done: {
      id: 'done',
      url: 'https://x.com/done/status/3',
      text: 'Already completed',
      author: 'Done author',
      saveRank: 3,
    },
  },
  cleared: {
    newer: { action: 'keep', at: '2026-07-11T10:00:00Z' },
    done: { action: 'done', at: '2026-07-11T11:00:00Z' },
  },
  meta: {
    total: 3,
    lastSync: '2026-07-11T12:00:00Z',
    syncStatus: 'idle',
    syncError: null,
  },
  settings: { confirmRealDelete: true, deleteConfirmed: false, keepCooldownHours: 72 },
};

function makeDocument() {
  const document = {
    activeElement: null,
    body: null,
    createElement: null,
    getElementById: null,
  };
  const body = new FakeElement('body');
  body.ownerDocument = document;
  document.body = body;
  document.activeElement = body;
  const elements = Object.fromEntries([
    ['left', 'span'],
    ['total', 'span'],
    ['lastSync', 'div'],
    ['sync', 'button'],
    ['error', 'div'],
    ['undoNotice', 'div'],
    ['activity', 'div'],
    ['confirmDelete', 'input'],
    ['list', 'main'],
  ].map(([id, tag]) => {
    const element = new FakeElement(tag);
    element.ownerDocument = document;
    element.id = id;
    body.append(element);
    return [id, element];
  }));
  elements.sync.textContent = 'Sync now';
  elements.error.hidden = true;
  elements.undoNotice.hidden = true;
  elements.confirmDelete.type = 'checkbox';
  elements.list.textContent = 'Loading…';
  document.createElement = (tag) => {
    const element = new FakeElement(tag);
    element.ownerDocument = document;
    return element;
  };
  document.getElementById = (id) => elements[id] ?? null;
  document.elements = elements;
  return document;
}

async function loadPopup({ sendMessage, storageState, confirm = vi.fn(() => true) } = {}) {
  const document = makeDocument();
  let storageChanged;
  const local = {
    get: vi.fn().mockResolvedValue(storageState ?? { settings: BASE_STATE.settings }),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const runtimeSend = sendMessage ?? vi.fn(async (message) => {
    if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
    return { ok: true };
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: runtimeSend },
    storage: {
      local,
      onChanged: { addListener: vi.fn((callback) => { storageChanged = callback; }) },
    },
  });
  await import('../src/popup.js');
  await vi.waitFor(() => expect(runtimeSend).toHaveBeenCalledWith({ type: 'XBI_GET_STATE' }));
  return {
    body: document.body,
    document,
    elements: document.elements,
    confirm,
    local,
    runtimeSend,
    storageChanged,
  };
}

function buttonNamed(root, label) {
  return root.querySelectorAll('button').find((button) => button.textContent === label);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function cssColor(html, token) {
  return html.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{3,6})`, 'i'))?.[1];
}

function luminance(hex) {
  const value = hex.length === 4
    ? hex.slice(1).split('').map((part) => `${part}${part}`)
    : hex.slice(1).match(/.{2}/g);
  const [red, green, blue] = value
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('popup dashboard', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders count, oldest-first rows, safe text, and explicit X links', async () => {
    const fixture = await loadPopup();

    await vi.waitFor(() => expect(fixture.elements.left.textContent).toBe('2'));
    expect(fixture.elements.total.textContent).toBe('3');
    const rows = fixture.elements.list.querySelectorAll('article');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.querySelector('.rank').textContent)).toEqual(['#1', '#2']);
    expect(rows[1].querySelector('.snippet').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(rows[1].querySelectorAll('img')).toHaveLength(0);
    const links = fixture.elements.list.querySelectorAll('a');
    expect(links.map((link) => [link.textContent, link.href])).toEqual([
      ['Open bookmark on X', 'https://x.com/oldest/status/1'],
      ['Open bookmark on X', 'https://x.com/newer/status/2'],
    ]);
  });

  it('does not expose navigation for a non-X cached URL', async () => {
    const state = structuredClone(BASE_STATE);
    state.bookmarks.oldest.url = 'javascript:alert(document.cookie)';
    const sendMessage = vi.fn(async (message) => message.type === 'XBI_GET_STATE'
      ? state
      : { ok: true });
    const fixture = await loadPopup({ sendMessage });

    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    const oldestRow = fixture.elements.list.querySelectorAll('article')[0];
    expect(oldestRow.querySelectorAll('a')).toHaveLength(0);
    expect(oldestRow.textContent).toContain('Link unavailable');
  });

  it('keeps a row counted and disables its actions while Keep is pending', async () => {
    let resolveKeep;
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
      if (message.action === 'keep') return new Promise((resolve) => { resolveKeep = resolve; });
      return { ok: true };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    const oldestRow = fixture.elements.list.querySelectorAll('article')[0];
    const keep = buttonNamed(oldestRow, 'Keep');

    const action = keep.dispatch('click');
    await vi.waitFor(() => expect(keep.textContent).toBe('Keeping…'));
    expect(oldestRow.querySelectorAll('button').every((button) => button.disabled)).toBe(true);
    expect(keep.getAttribute('aria-label')).toBe('Keeping bookmark by @oldest');
    expect(keep.parentElement.getAttribute('aria-busy')).toBe('true');
    expect(fixture.elements.activity.textContent).toBe('Keeping bookmark');
    resolveKeep({ ok: true });
    await action;

    expect(fixture.elements.left.textContent).toBe('2');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
    expect(fixture.runtimeSend).toHaveBeenCalledWith({ type: 'XBI_ACTION', action: 'keep', tweetId: 'oldest' });
    expect(fixture.elements.activity.textContent).toBe('');
  });

  it('coalesces storage renders and commits only the newest generation', async () => {
    const reads = [];
    const sendMessage = vi.fn((message) => {
      if (message.type !== 'XBI_GET_STATE') return Promise.resolve({ ok: true });
      const read = deferred();
      reads.push(read);
      return read.promise;
    });
    const fixture = await loadPopup({ sendMessage });

    fixture.storageChanged({}, 'local');
    fixture.storageChanged({}, 'local');
    expect(reads).toHaveLength(1);

    const stale = structuredClone(BASE_STATE);
    stale.bookmarks = { oldest: BASE_STATE.bookmarks.oldest };
    stale.cleared = {};
    reads[0].resolve(stale);
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    reads[1].resolve(structuredClone(BASE_STATE));

    await vi.waitFor(() => expect(fixture.elements.left.textContent).toBe('2'));
    expect(reads).toHaveLength(2);
    expect(fixture.elements.total.textContent).toBe('3');
  });

  it('does not let a storage render replace pending row controls', async () => {
    const keep = deferred();
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
      if (message.action === 'keep') return keep.promise;
      return { ok: true };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    const pending = buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Keep').dispatch('click');
    await vi.waitFor(() => expect(buttonNamed(fixture.elements.list, 'Keeping…')).toBeDefined());

    fixture.storageChanged({}, 'local');
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'XBI_GET_STATE')).toHaveLength(2));

    const pendingButton = buttonNamed(fixture.elements.list, 'Keeping…');
    expect(pendingButton).toBeDefined();
    expect(pendingButton.parentElement.querySelectorAll('button').every((button) => button.disabled)).toBe(true);
    keep.resolve({ ok: false, error: 'Keep failed' });
    await pending;
  });

  it('requires one-time confirmation and leaves the row untouched when cancelled', async () => {
    const confirm = vi.fn(() => false);
    const fixture = await loadPopup({ confirm });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');

    expect(confirm).toHaveBeenCalledWith('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
    expect(fixture.runtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'XBI_ACTION' }));
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
    expect(fixture.elements.list.querySelectorAll('button')
      .filter((button) => button.textContent === 'Done')
      .every((button) => !button.disabled)).toBe(true);
  });

  it('fails closed on malformed Done responses and thrown action requests', async () => {
    const responses = [{ ok: true }, new Error('runtime unavailable')];
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');
    expect(fixture.elements.error.textContent).toBe('Action failed');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');
    expect(fixture.elements.error.textContent).toBe('runtime unavailable');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
  });

  it('removes a valid Done row and restores it through Undo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    let state = structuredClone(BASE_STATE);
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared.oldest = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        return { ok: true, undoUntil: Date.now() + 6_000 };
      }
      if (message.action === 'undo') {
        delete state.cleared.oldest;
        return { ok: true };
      }
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');

    expect(fixture.elements.left.textContent).toBe('1');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(1);
    expect(fixture.elements.undoNotice.textContent).toContain('Removed from X.');
    const undo = buttonNamed(fixture.elements.undoNotice, 'Undo');
    expect(undo).toBeDefined();
    expect(fixture.document.activeElement).toBe(undo);

    await undo.dispatch('click');

    expect(fixture.runtimeSend).toHaveBeenLastCalledWith({ type: 'XBI_GET_STATE' });
    expect(fixture.elements.left.textContent).toBe('2');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
    expect(fixture.elements.undoNotice.hidden).toBe(true);
    expect(fixture.document.activeElement).toBe(buttonNamed(fixture.elements.list, 'Done'));
    expect(buttonNamed(fixture.elements.list, 'Done').disabled).toBe(false);
  });

  it('does not let a storage render erase an active Undo control', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared.oldest = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        return { ok: true, undoUntil: Date.now() + 6_000 };
      }
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeDefined();

    fixture.storageChanged({}, 'local');
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'XBI_GET_STATE')).toHaveLength(3));

    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeDefined();
    expect(fixture.elements.undoNotice.textContent).toContain('Removed from X.');
  });

  it('blocks a second Done through rerenders for the first Undo full window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    let undoUntil;
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared[message.tweetId] = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        undoUntil = Date.now() + 6_000;
        return { ok: true, undoUntil };
      }
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');
    const firstUndo = buttonNamed(fixture.elements.undoNotice, 'Undo');

    const remainingDone = buttonNamed(fixture.elements.list, 'Done');
    expect(remainingDone.disabled).toBe(true);
    expect(buttonNamed(fixture.elements.list, 'Keep').disabled).toBe(false);
    await remainingDone.dispatch('click');
    fixture.storageChanged({}, 'local');
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'XBI_GET_STATE')).toHaveLength(3));

    expect(buttonNamed(fixture.elements.list, 'Done').disabled).toBe(true);
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBe(firstUndo);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'XBI_ACTION' && message.action === 'done')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(Math.max(0, undoUntil - Date.now() - 1));
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBe(firstUndo);
    await vi.advanceTimersByTimeAsync(2);
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeUndefined();
  });

  it('sets the global Done gate before the first mutation resolves and retains it on success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    const firstResult = deferred();
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') return firstResult.promise;
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    const [firstDone, secondDone] = fixture.elements.list.querySelectorAll('button')
      .filter((button) => button.textContent === 'Done');

    const firstClick = firstDone.dispatch('click');
    await vi.waitFor(() => expect(sendMessage.mock.calls
      .filter(([message]) => message.type === 'XBI_ACTION' && message.action === 'done')).toHaveLength(1));
    fixture.storageChanged({}, 'local');
    await vi.waitFor(() => expect(sendMessage.mock.calls
      .filter(([message]) => message.type === 'XBI_GET_STATE')).toHaveLength(2));
    const disabledBeforeResolve = secondDone.disabled;
    const secondClick = secondDone.dispatch('click');

    state.cleared.oldest = { action: 'done', at: new Date().toISOString() };
    state.settings.deleteConfirmed = true;
    firstResult.resolve({ ok: true, undoUntil: Date.now() + 6_000 });
    await Promise.all([firstClick, secondClick]);

    expect(disabledBeforeResolve).toBe(true);
    expect(sendMessage.mock.calls
      .filter(([message]) => message.type === 'XBI_ACTION' && message.action === 'done')).toHaveLength(1);
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeDefined();
    expect(buttonNamed(fixture.elements.list, 'Done').disabled).toBe(true);
  });

  it('releases the global Done gate after the first mutation fails and allows one retry', async () => {
    const firstResult = deferred();
    let doneCalls = 0;
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
      if (message.action === 'done') {
        doneCalls += 1;
        return doneCalls === 1 ? firstResult.promise : { ok: false, error: 'retry failed' };
      }
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    const [firstDone, secondDone] = fixture.elements.list.querySelectorAll('button')
      .filter((button) => button.textContent === 'Done');

    const firstClick = firstDone.dispatch('click');
    await vi.waitFor(() => expect(doneCalls).toBe(1));
    const disabledBeforeResolve = secondDone.disabled;
    await secondDone.dispatch('click');
    const callsBeforeResolve = doneCalls;
    firstResult.resolve({ ok: false, error: 'first failed' });
    await firstClick;

    const retry = buttonNamed(fixture.elements.list, 'Done');
    expect(retry.disabled).toBe(false);
    await retry.dispatch('click');

    expect(disabledBeforeResolve).toBe(true);
    expect(callsBeforeResolve).toBe(1);
    expect(doneCalls).toBe(2);
  });

  it('keeps Undo visible while sync, settings, and Keep failures use the error region', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared[message.tweetId] = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        return { ok: true, undoUntil: Date.now() + 6_000 };
      }
      if (message.type === 'XBI_SYNC') return { ok: false, error: 'Sync failed during Undo' };
      if (message.type === 'XBI_UPDATE_SETTINGS') return { ok: false, error: 'Settings failed during Undo' };
      if (message.action === 'keep') return { ok: false, error: 'Keep failed during Undo' };
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    await buttonNamed(fixture.elements.list, 'Done').dispatch('click');
    const undo = buttonNamed(fixture.elements.undoNotice, 'Undo');

    await fixture.elements.sync.dispatch('click');
    expect(fixture.elements.error.textContent).toBe('Sync failed during Undo');
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBe(undo);

    fixture.elements.confirmDelete.checked = false;
    await fixture.elements.confirmDelete.dispatch('change');
    expect(fixture.elements.error.textContent).toBe('Settings failed during Undo');
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBe(undo);

    await buttonNamed(fixture.elements.list, 'Keep').dispatch('click');
    expect(fixture.elements.error.textContent).toBe('Keep failed during Undo');
    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBe(undo);
  });

  it('shows Undo expiry and moves focus to Sync when the window closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared.oldest = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        return { ok: true, undoUntil: Date.now() + 6_000 };
      }
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    await buttonNamed(fixture.elements.list, 'Done').dispatch('click');

    await vi.advanceTimersByTimeAsync(6_001);

    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeUndefined();
    expect(fixture.elements.undoNotice.textContent).toBe('Undo window expired');
    expect(fixture.document.activeElement).toBe(fixture.elements.sync);
    expect(buttonNamed(fixture.elements.list, 'Done').disabled).toBe(false);
  });

  it('never restores a failed Undo button after its deadline passes in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    const state = structuredClone(BASE_STATE);
    const restore = deferred();
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(state);
      if (message.action === 'done') {
        state.cleared.oldest = { action: 'done', at: new Date().toISOString() };
        state.settings.deleteConfirmed = true;
        return { ok: true, undoUntil: Date.now() + 6_000 };
      }
      if (message.action === 'undo') return restore.promise;
      return { ok: false };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));
    await buttonNamed(fixture.elements.list, 'Done').dispatch('click');
    const undo = buttonNamed(fixture.elements.undoNotice, 'Undo');

    const pending = undo.dispatch('click');
    await vi.waitFor(() => expect(undo.textContent).toBe('Restoring…'));
    expect(undo.getAttribute('aria-label')).toBe('Restoring bookmark');
    expect(fixture.elements.undoNotice.getAttribute('aria-busy')).toBe('true');
    expect(fixture.elements.activity.textContent).toBe('Restoring bookmark');
    await vi.advanceTimersByTimeAsync(6_001);
    restore.resolve({ ok: false, error: 'restore failed' });
    await pending;

    expect(buttonNamed(fixture.elements.undoNotice, 'Undo')).toBeUndefined();
    expect(fixture.elements.undoNotice.textContent).toBe('Undo window expired');
    expect(fixture.elements.undoNotice.getAttribute('aria-busy')).toBe('false');
    expect(fixture.document.activeElement).toBe(fixture.elements.sync);
  });

  it('restores Sync controls and reports a failed sync after refreshing state', async () => {
    let resolveSync;
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'XBI_GET_STATE') return structuredClone(BASE_STATE);
      if (message.type === 'XBI_SYNC') return new Promise((resolve) => { resolveSync = resolve; });
      return { ok: true };
    });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.left.textContent).toBe('2'));

    const syncing = fixture.elements.sync.dispatch('click');
    await vi.waitFor(() => expect(fixture.elements.sync.textContent).toBe('Syncing…'));
    expect(fixture.elements.sync.disabled).toBe(true);
    expect(fixture.elements.sync.getAttribute('aria-label')).toBe('Syncing bookmarks');
    expect(fixture.elements.sync.getAttribute('aria-busy')).toBe('true');
    expect(fixture.elements.activity.textContent).toBe('Syncing bookmarks');
    resolveSync({ ok: false, error: 'Sync blocked' });
    await syncing;

    expect(fixture.elements.sync.disabled).toBe(false);
    expect(fixture.elements.sync.textContent).toBe('Sync now');
    expect(fixture.elements.sync.getAttribute('aria-busy')).toBe('false');
    expect(fixture.elements.error.textContent).toBe('Sync blocked');
  });

  it('shows a stable error state when loading state fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('worker stopped'));
    const fixture = await loadPopup({ sendMessage });

    await vi.waitFor(() => expect(fixture.elements.error.textContent).toBe('worker stopped'));
    expect(fixture.elements.left.textContent).toBe('—');
    expect(fixture.elements.total.textContent).toBe('—');
    expect(fixture.elements.list.textContent).toContain('Unable to load bookmarks.');
  });

  it('distinguishes an empty cache from an all-caught-up cache', async () => {
    let state = { ...structuredClone(BASE_STATE), bookmarks: {}, cleared: {} };
    const sendMessage = vi.fn(async (message) => message.type === 'XBI_GET_STATE'
      ? structuredClone(state)
      : { ok: true });
    const fixture = await loadPopup({ sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.textContent).toContain('No cached bookmarks yet.'));

    state = structuredClone(BASE_STATE);
    state.cleared = Object.fromEntries(Object.keys(state.bookmarks)
      .map((id) => [id, { action: 'done', at: '2026-07-11T12:00:00Z' }]));
    fixture.storageChanged({}, 'local');

    await vi.waitFor(() => expect(fixture.elements.list.textContent).toBe('All caught up. No bookmarks left.'));
  });

  it.each([
    [undefined, true],
    [null, true],
    [{}, true],
    [{ confirmRealDelete: 'false', deleteConfirmed: false }, true],
    [{ confirmRealDelete: true, deleteConfirmed: 'true' }, true],
    [{ confirmRealDelete: false, deleteConfirmed: false }, false],
    [{ confirmRealDelete: true, deleteConfirmed: true }, false],
  ])('normalizes confirmation settings fail-safe: %j', async (settings, shouldConfirm) => {
    const state = structuredClone(BASE_STATE);
    state.settings = settings;
    const confirm = vi.fn(() => false);
    const sendMessage = vi.fn(async (message) => message.type === 'XBI_GET_STATE'
      ? state
      : { ok: false, error: 'not expected' });
    const fixture = await loadPopup({ confirm, sendMessage });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');

    expect(confirm).toHaveBeenCalledTimes(shouldConfirm ? 1 : 0);
  });

  it('patches the confirmation field through the serialized background message', async () => {
    const fixture = await loadPopup();
    await vi.waitFor(() => expect(fixture.elements.confirmDelete.checked).toBe(true));

    fixture.elements.confirmDelete.checked = false;
    await fixture.elements.confirmDelete.dispatch('change');

    expect(fixture.runtimeSend).toHaveBeenCalledWith({
      type: 'XBI_UPDATE_SETTINGS',
      patch: { confirmRealDelete: false },
    });
    expect(fixture.local.get).not.toHaveBeenCalled();
    expect(fixture.local.set).not.toHaveBeenCalled();
  });

  it('provides semantic live regions, visible focus, and 24px action targets', async () => {
    const [html, script] = await Promise.all([
      readFile(new URL('../public/popup.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/popup.js', import.meta.url), 'utf8'),
    ]);

    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/id="error"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="undoNotice"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toContain(':focus-visible');
    expect(html).toMatch(/min-height:\s*24px/);
    expect(html).toContain('aria-label="Confirm before deleting bookmarks from X"');
    expect(script).not.toContain("addEventListener('dblclick'");
  });

  it('meets objective contrast gates for primary, hover, and focus colors', async () => {
    const html = await readFile(new URL('../public/popup.html', import.meta.url), 'utf8');
    const background = cssColor(html, 'bg');
    const primary = cssColor(html, 'blue');
    const hover = cssColor(html, 'blue-hover');
    const textBlue = cssColor(html, 'blue-text');

    expect(contrast(primary, '#fff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hover, '#fff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primary, background)).toBeGreaterThanOrEqual(3);
    expect(textBlue).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(textBlue, background)).toBeGreaterThanOrEqual(4.5);
    expect(html).toMatch(/\.rank\s*{[^}]*color:\s*var\(--blue-text\)/s);
    expect(html).toContain('@media (forced-colors: active)');
    expect(html).toContain('outline: 2px solid Highlight');
  });
});
