import { afterEach, describe, expect, it, vi } from 'vitest';
import { isForYouLabel, isHome } from '../src/selectors.js';

afterEach(() => vi.unstubAllGlobals());

describe('isForYouLabel', () => {
  it('matches only a string For You label', () => {
    expect(isForYouLabel(' For you ')).toBe(true);
    expect(isForYouLabel('Following')).toBe(false);
    expect(isForYouLabel(null)).toBe(false);
    expect(isForYouLabel(42)).toBe(false);
  });
});

describe('isHome', () => {
  it('requires Home and a selected For You tab inside the primary column', () => {
    const selectedTab = { textContent: 'For You' };
    const primaryColumn = { querySelector: vi.fn().mockReturnValue(selectedTab) };
    const querySelector = vi.fn().mockReturnValue(primaryColumn);
    vi.stubGlobal('location', { pathname: '/home' });
    vi.stubGlobal('document', { querySelector });

    expect(isHome()).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('[data-testid="primaryColumn"]');
    expect(primaryColumn.querySelector).toHaveBeenCalledWith('[role="tab"][aria-selected="true"]');
  });

  it('fails closed outside Home or without a primary-column For You selection', () => {
    vi.stubGlobal('location', { pathname: '/profile' });
    vi.stubGlobal('document', { querySelector: vi.fn() });
    expect(isHome()).toBe(false);

    location.pathname = '/home';
    document.querySelector.mockReturnValue({
      querySelector: vi.fn().mockReturnValue({ textContent: 'Following' }),
    });
    expect(isHome()).toBe(false);

    document.querySelector.mockReturnValue(null);
    expect(isHome()).toBe(false);
  });
});
