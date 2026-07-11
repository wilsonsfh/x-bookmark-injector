import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCardMeta, buildCardElement } from '../src/ui/card.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.eventListeners = new Map();
    this.id = '';
    this.parentElement = null;
    this.style = { cssText: '' };
    this.textContent = '';
    this.type = '';
  }

  append(...children) {
    for (const child of children) {
      this.children.push(child);
      child.parentElement = this;
    }
  }

  addEventListener(type, handler) {
    this.eventListeners.set(type, handler);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  findAll(tagName) {
    return this.children.flatMap((child) => [
      ...(child.tagName === tagName.toUpperCase() ? [child] : []),
      ...child.findAll(tagName),
    ]);
  }
}

function installDom() {
  vi.stubGlobal('document', { createElement: (tag) => new FakeElement(tag) });
  vi.stubGlobal('window', { open: vi.fn() });
}

afterEach(() => vi.unstubAllGlobals());

describe('formatCardMeta', () => {
  it('labels save order, posted date, and remaining count honestly', () => {
    expect(formatCardMeta({ saveRank: 12, createdAt: '2026-06-21T13:37:00Z' }, 87, 74)).toEqual({
      rank: 'Saved #12 of 87 · 12th oldest',
      posted: 'Posted Jun 21, 2026',
      left: '74 left',
    });
  });

  it('uses correct ordinal suffixes', () => {
    expect(formatCardMeta({ saveRank: 1 }, 20, 20).rank).toContain('1st oldest');
    expect(formatCardMeta({ saveRank: 2 }, 20, 20).rank).toContain('2nd oldest');
    expect(formatCardMeta({ saveRank: 3 }, 20, 20).rank).toContain('3rd oldest');
    expect(formatCardMeta({ saveRank: 11 }, 20, 20).rank).toContain('11th oldest');
    expect(formatCardMeta({ saveRank: 12 }, 20, 20).rank).toContain('12th oldest');
    expect(formatCardMeta({ saveRank: 13 }, 20, 20).rank).toContain('13th oldest');
    expect(formatCardMeta({ saveRank: 21 }, 20, 20).rank).toContain('21st oldest');
  });

  it('states when the posted time is unavailable', () => {
    expect(formatCardMeta({ saveRank: 4 }, 9, 6).posted).toBe('Posted time unavailable');
  });
});

describe('buildCardElement', () => {
  it('builds a semantic Hybrid card with scoped tokens and overflow-safe user content', () => {
    installDom();
    const bookmark = {
      author: 'A'.repeat(120),
      avatar: 'https://pbs.twimg.com/profile.jpg',
      createdAt: '2026-06-21T13:37:00Z',
      handle: '@author_with_a_long_handle',
      media: [{ url: 'https://pbs.twimg.com/media.jpg' }],
      saveRank: 12,
      text: '<img src=x onerror=alert(1)>\nA long bookmark body that must wrap safely.',
      url: 'https://x.com/author/status/123',
    };

    const card = buildCardElement(bookmark, { total: 87, left: 74 }, { onKeep: vi.fn(), onDone: vi.fn() });

    expect(card.tagName).toBe('ARTICLE');
    expect(card.id).toBe('xbi-card');
    expect(card.dataset.testid).toBe('cellInnerDiv');
    expect(card['aria-label']).toBe('Bookmark resurfaced');
    expect(card.findAll('style')[0].textContent).toContain('--xbi-accent: #1d9bf0');
    expect(card.findAll('style')[0].textContent).toContain('overflow-wrap: anywhere');
    expect(card.findAll('style')[0].textContent).toContain('@media (prefers-reduced-motion: reduce)');
    expect(card.findAll('strong').some((node) => node.textContent === bookmark.author)).toBe(true);
    expect(card.findAll('p').some((node) => node.textContent === bookmark.text)).toBe(true);
    expect(card.findAll('img')).toHaveLength(2);
  });

  it('provides focus-visible action buttons with usable targets and invokes handlers', () => {
    installDom();
    const onKeep = vi.fn();
    const onDone = vi.fn();
    const card = buildCardElement(
      { author: 'Zara Zhang', handle: '@zarazhangrui', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep, onDone },
    );
    const buttons = card.findAll('button');
    const css = card.findAll('style')[0].textContent;

    expect(buttons.map((button) => button.textContent)).toEqual(['Keep for later', 'Done ✓ Remove from X']);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
    expect(css).toContain('--xbi-target-size: 36px');
    expect(css).toContain('min-height: var(--xbi-target-size)');
    expect(css).toContain(':focus-visible');
    buttons[0].eventListeners.get('click')();
    buttons[1].eventListeners.get('click')();
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('opens the original bookmark safely on double click', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me', url: 'https://x.com/zara/status/1' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );

    card.eventListeners.get('dblclick')();

    expect(window.open).toHaveBeenCalledWith('https://x.com/zara/status/1', '_blank', 'noopener');
  });

  it('does not open the bookmark when an action button is double clicked', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me', url: 'https://x.com/zara/status/1' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );

    card.eventListeners.get('dblclick')({ target: { closest: () => ({ tagName: 'BUTTON' }) } });

    expect(window.open).not.toHaveBeenCalled();
  });
});
