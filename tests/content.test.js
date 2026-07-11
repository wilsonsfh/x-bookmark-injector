import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  constructor(attributes = {}, textContent = '', tagName = 'div') {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.eventListeners = new Map();
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

  append(...children) {
    for (const child of children) {
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
  meta: { total: 1 },
  settings: { keepCooldownHours: 72, confirmRealDelete: true, deleteConfirmed: false },
};

async function loadContent(options = {}) {
  const fixture = makeFixture();
  const location = { pathname: '/home' };
  const storageGet = options.storageGet ?? vi.fn().mockResolvedValue(TEST_STATE);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  const confirm = vi.fn().mockReturnValue(true);
  let mutationCallback;
  let observerOptions;
  let intervalCallback;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  vi.stubGlobal('document', fixture.document);
  vi.stubGlobal('location', location);
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    storage: { local: { get: storageGet } },
  });
  vi.stubGlobal('window', { confirm, open: vi.fn() });
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
  await import('../src/content.js');
  await flush();

  return {
    ...fixture,
    confirm,
    flush,
    interval: async () => { intervalCallback(); await flush(); },
    location,
    mutate: async () => { mutationCallback(); await flush(); },
    observerOptions,
    sendMessage,
    storageGet,
  };
}

describe('bookmark card injection', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
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

  it('sends keep and confirmed done actions and dismisses the card', async () => {
    const fixture = await loadContent();
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
});
