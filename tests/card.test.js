import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTweet } from '../src/core/normalize.js';
import { formatCardMeta, buildCardElement } from '../src/ui/card.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.eventListeners = new Map();
    this.hidden = false;
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

  removeAttribute(name) {
    delete this[name];
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

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[\da-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function cssToken(css, name) {
  return css.match(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
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
    expect(formatCardMeta({ saveRank: 4, createdAt: 'not-a-date' }, 9, 6).posted).toBe('Posted time unavailable');
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

  it('provides focus-visible action buttons with usable targets and invokes handlers', async () => {
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
    expect(css).toContain('.xbi-action:disabled');
    expect(css).toContain('opacity: .55');
    expect(css).toContain('cursor: wait');
    await buttons[0].eventListeners.get('click')();
    await buttons[1].eventListeners.get('click')();
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('inherits X text contrast across OS and X theme mismatches', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );
    const css = card.findAll('style')[0].textContent;
    const accentFill = cssToken(css, '--xbi-accent');
    const onAccent = cssToken(css, '--xbi-on-accent');

    expect(css).toContain('--xbi-accent-text: currentColor');
    expect(css).not.toContain('@media (prefers-color-scheme: dark)');
    expect(contrastRatio('#e7e9ea', '#000000')).toBeGreaterThanOrEqual(4.5); // OS light, X dark.
    expect(contrastRatio('#0f1419', '#ffffff')).toBeGreaterThanOrEqual(4.5); // OS dark, X light.
    expect(contrastRatio(onAccent, accentFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the focused primary action a contrasting inset indicator on X dark', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );
    const css = card.findAll('style')[0].textContent;
    const accentFill = cssToken(css, '--xbi-accent');
    const insetFocus = cssToken(css, '--xbi-on-accent');

    expect(css).toContain('.xbi-action-primary:focus-visible');
    expect(css).toContain('box-shadow: inset 0 0 0 3px var(--xbi-on-accent)');
    expect(contrastRatio(accentFill, '#000000')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(insetFocus, accentFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('restores a system-color outline for primary focus in forced colors', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );
    const css = card.findAll('style')[0].textContent;
    const forcedColors = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/)?.[1];

    expect(forcedColors).toContain('.xbi-action-primary:focus-visible');
    expect(forcedColors).toContain('outline: 2px solid Highlight');
    expect(forcedColors).toContain('outline-offset: 2px');
    expect(forcedColors).toContain('box-shadow: none');
  });

  it('locks both actions while one request is pending and ignores duplicate clicks', async () => {
    installDom();
    let resolveAction;
    const onKeep = vi.fn(() => new Promise((resolve) => { resolveAction = resolve; }));
    const onDone = vi.fn();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep, onDone },
    );
    const buttons = card.findAll('button');

    const pending = buttons[0].eventListeners.get('click')();
    const duplicate = buttons[1].eventListeners.get('click')();

    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(card['aria-busy']).toBe('true');

    resolveAction({ ok: true });
    await pending;
    await duplicate;
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(card['aria-busy']).toBeUndefined();
  });

  it('announces rejected and unsuccessful actions without removing the card', async () => {
    installDom();
    const onKeep = vi.fn().mockRejectedValue(new Error('offline'));
    const onDone = vi.fn().mockResolvedValue({ ok: false, error: 'X did not confirm the action.' });
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      { onKeep, onDone },
    );
    const buttons = card.findAll('button');
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await expect(buttons[0].eventListeners.get('click')()).resolves.toBeUndefined();
    expect(status.role).toBe('status');
    expect(status['aria-live']).toBe('polite');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');

    await buttons[1].eventListeners.get('click')();
    expect(status.textContent).toBe('X did not confirm the action.');
    expect(card.parentElement).toBeNull();
  });

  it('fails closed on undefined and malformed action responses', async () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me' },
      { total: 1, left: 1 },
      {
        onKeep: vi.fn().mockResolvedValue(undefined),
        onDone: vi.fn().mockResolvedValue({ unexpected: true }),
      },
    );
    const buttons = card.findAll('button');
    const status = card.findAll('p').find((node) => node.className === 'xbi-status');

    await buttons[0].eventListeners.get('click')();
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');
    expect(status.hidden).toBe(false);

    await buttons[1].eventListeners.get('click')();
    expect(status.textContent).toBe('Could not update this bookmark. Try again.');
    expect(status.hidden).toBe(false);
  });

  it('renders a visible keyboard-accessible link for a valid X post URL', () => {
    installDom();
    const card = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me', url: 'https://x.com/zara/status/1' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );

    const link = card.findAll('a')[0];

    expect(link.textContent).toBe('View post on X');
    expect(link.href).toBe('https://x.com/zara/status/1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(card.eventListeners.has('dblclick')).toBe(false);
  });

  it('accepts Twitter post URLs and omits untrusted post and image URLs', () => {
    installDom();
    const trusted = buildCardElement(
      { author: 'Zara Zhang', media: [], saveRank: 1, text: 'Read me', url: 'https://twitter.com/zara/status/1' },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );
    const untrusted = buildCardElement(
      {
        author: 'Mallory',
        avatar: 'https://example.com/avatar.jpg',
        media: [{ url: 'javascript:alert(1)' }],
        saveRank: 2,
        text: 'Unsafe links',
        url: 'https://x.com/home',
      },
      { total: 2, left: 2 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );

    expect(trusted.findAll('a')[0].href).toBe('https://twitter.com/zara/status/1');
    expect(untrusted.findAll('a')).toHaveLength(0);
    expect(untrusted.findAll('img')).toHaveLength(0);
  });

  it('preserves media alt text and supplies an author-aware fallback', () => {
    installDom();
    const described = buildCardElement(
      {
        author: 'Zara Zhang',
        media: [{ url: 'https://pbs.twimg.com/media.jpg', alt: 'Diagram of the bookmark workflow' }],
        saveRank: 1,
        text: 'Read me',
      },
      { total: 1, left: 1 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );
    const fallback = buildCardElement(
      {
        author: 'Zara Zhang',
        media: [{ url: 'https://pbs.twimg.com/media-2.jpg' }],
        saveRank: 2,
        text: 'Read me too',
      },
      { total: 2, left: 2 },
      { onKeep: vi.fn(), onDone: vi.fn() },
    );

    expect(described.findAll('img')[0].alt).toBe('Diagram of the bookmark workflow');
    expect(fallback.findAll('img')[0].alt).toBe("Image from Zara Zhang's bookmarked post");
  });

  it('renders X ext_alt_text carried through tweet normalization', () => {
    installDom();
    const bookmark = normalizeTweet({
      rest_id: '1806',
      legacy: {
        full_text: 'I hoard X bookmarks',
        extended_entities: {
          media: [{
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/workflow.jpg',
            ext_alt_text: 'Diagram of the bookmark workflow',
          }],
        },
      },
      core: {
        user_results: {
          result: { legacy: { name: 'Zara Zhang', screen_name: 'zarazhangrui' } },
        },
      },
    });
    bookmark.saveRank = 1;

    const card = buildCardElement(bookmark, { total: 1, left: 1 }, { onKeep: vi.fn(), onDone: vi.fn() });

    expect(card.findAll('img')[0].alt).toBe('Diagram of the bookmark workflow');
  });
});
