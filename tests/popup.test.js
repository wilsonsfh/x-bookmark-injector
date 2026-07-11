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
    for (const child of this.children) {
      if (typeof child !== 'string') child.parentElement = null;
    }
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
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
  const body = new FakeElement('body');
  const elements = Object.fromEntries([
    ['left', 'span'],
    ['total', 'span'],
    ['lastSync', 'div'],
    ['sync', 'button'],
    ['error', 'div'],
    ['confirmDelete', 'input'],
    ['list', 'main'],
  ].map(([id, tag]) => {
    const element = new FakeElement(tag);
    element.id = id;
    body.append(element);
    return [id, element];
  }));
  elements.sync.textContent = 'Sync now';
  elements.error.hidden = true;
  elements.confirmDelete.type = 'checkbox';
  elements.list.textContent = 'Loading…';
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => elements[id] ?? null,
    elements,
  };
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
  return { ...document, confirm, local, runtimeSend, storageChanged };
}

function buttonNamed(root, label) {
  return root.querySelectorAll('button').find((button) => button.textContent === label);
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
    resolveKeep({ ok: true });
    await action;

    expect(fixture.elements.left.textContent).toBe('2');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
    expect(fixture.runtimeSend).toHaveBeenCalledWith({ type: 'XBI_ACTION', action: 'keep', tweetId: 'oldest' });
  });

  it('requires one-time confirmation and leaves the row untouched when cancelled', async () => {
    const confirm = vi.fn(() => false);
    const fixture = await loadPopup({ confirm });
    await vi.waitFor(() => expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2));

    await buttonNamed(fixture.elements.list.querySelectorAll('article')[0], 'Done').dispatch('click');

    expect(confirm).toHaveBeenCalledWith('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
    expect(fixture.runtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'XBI_ACTION' }));
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
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
    expect(fixture.elements.error.textContent).toContain('Removed from X.');
    const undo = buttonNamed(fixture.elements.error, 'Undo');
    expect(undo).toBeDefined();

    await undo.dispatch('click');

    expect(fixture.runtimeSend).toHaveBeenLastCalledWith({ type: 'XBI_GET_STATE' });
    expect(fixture.elements.left.textContent).toBe('2');
    expect(fixture.elements.list.querySelectorAll('article')).toHaveLength(2);
    expect(fixture.elements.error.hidden).toBe(true);
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
    resolveSync({ ok: false, error: 'Sync blocked' });
    await syncing;

    expect(fixture.elements.sync.disabled).toBe(false);
    expect(fixture.elements.sync.textContent).toBe('Sync now');
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

  it('persists the confirmation toggle without dropping other settings', async () => {
    const stored = { settings: { ...BASE_STATE.settings, syncEveryHours: 24 } };
    const fixture = await loadPopup({ storageState: stored });
    await vi.waitFor(() => expect(fixture.elements.confirmDelete.checked).toBe(true));

    fixture.elements.confirmDelete.checked = false;
    await fixture.elements.confirmDelete.dispatch('change');

    expect(fixture.local.get).toHaveBeenCalledWith('settings');
    expect(fixture.local.set).toHaveBeenCalledWith({
      settings: { ...stored.settings, confirmRealDelete: false },
    });
  });

  it('provides semantic live regions, visible focus, and 24px action targets', async () => {
    const [html, script] = await Promise.all([
      readFile(new URL('../public/popup.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/popup.js', import.meta.url), 'utf8'),
    ]);

    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/id="error"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toContain(':focus-visible');
    expect(html).toMatch(/min-height:\s*24px/);
    expect(html).toContain('aria-label="Confirm before deleting bookmarks from X"');
    expect(script).not.toContain("addEventListener('dblclick'");
  });
});
