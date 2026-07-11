import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  constructor(attributes = {}, textContent = '') {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.id = '';
    this.innerHTML = '';
    this.parentElement = null;
    this.style = { cssText: '' };
    this.textContent = textContent;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  append(child) {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
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
    createElement: () => new FakeElement(),
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (selector) => body.querySelector(selector),
  };
  return { body, decoyTimeline, document, followingTab, forYouTab, primaryColumn, timeline };
}

async function loadContent() {
  const fixture = makeFixture();
  const location = { pathname: '/home' };
  let mutationCallback;
  let observerOptions;
  let intervalCallback;

  vi.stubGlobal('document', fixture.document);
  vi.stubGlobal('location', location);
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

  return {
    ...fixture,
    interval: () => intervalCallback(),
    location,
    mutate: () => mutationCallback(),
    observerOptions,
  };
}

describe('static bookmark card injection', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('inserts one card before the first cell of the primary-column timeline', async () => {
    const { body, decoyTimeline, timeline } = await loadContent();

    expect(timeline.children[0].id).toBe('xbi-card');
    expect(decoyTimeline.children.some((child) => child.id === 'xbi-card')).toBe(false);
    expect(body.querySelectorAll('#xbi-card')).toHaveLength(1);
  });

  it('deduplicates and restores first position after mutations and timeline replacement', async () => {
    const fixture = await loadContent();
    const card = fixture.document.getElementById('xbi-card');
    fixture.timeline.append(card);

    fixture.mutate();
    expect(fixture.timeline.children[0]).toBe(card);
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);

    const replacement = makeTimeline();
    fixture.primaryColumn.replaceChild(replacement, fixture.timeline);
    fixture.mutate();
    expect(replacement.children[0].id).toBe('xbi-card');
    expect(fixture.body.querySelectorAll('#xbi-card')).toHaveLength(1);
  });

  it('removes on navigation and restores on return to Home', async () => {
    const fixture = await loadContent();
    fixture.location.pathname = '/profile';
    fixture.interval();
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    fixture.location.pathname = '/home';
    fixture.interval();
    expect(fixture.timeline.children[0].id).toBe('xbi-card');
  });

  it('removes on Following and restores on For You without a pathname change', async () => {
    const fixture = await loadContent();
    fixture.forYouTab.setAttribute('aria-selected', 'false');
    fixture.followingTab.setAttribute('aria-selected', 'true');
    fixture.mutate();
    expect(fixture.document.getElementById('xbi-card')).toBeNull();

    fixture.followingTab.setAttribute('aria-selected', 'false');
    fixture.forYouTab.setAttribute('aria-selected', 'true');
    fixture.mutate();
    expect(fixture.timeline.children[0].id).toBe('xbi-card');
    expect(fixture.observerOptions).toMatchObject({ attributes: true, attributeFilter: ['aria-selected'] });
  });
});
