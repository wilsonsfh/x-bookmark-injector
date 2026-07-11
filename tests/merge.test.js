import { describe, it, expect, vi } from 'vitest';
import { mergeBookmarks } from '../src/core/merge.js';

describe('mergeBookmarks', () => {
  const now = '2026-07-10T00:00:00.000Z';
  it('adds new, updates existing, drops server-removed, stamps fetchedAt', () => {
    const existing = { x: { id: 'x', text: 'old' }, y: { id: 'y', text: 'gone' } };
    const incoming = [{ id: 'x', text: 'new' }, { id: 'z', text: 'fresh' }];
    const merged = mergeBookmarks(existing, incoming, now);
    expect(Object.keys(merged).sort()).toEqual(['x', 'z']);
    expect(merged.x).toEqual({ id: 'x', text: 'new', fetchedAt: now });
    expect(merged.z).toEqual({ id: 'z', text: 'fresh', fetchedAt: now });
  });
  it('last duplicate id wins', () => {
    const incoming = [
      { id: 'a', text: '1', earlierOnly: true },
      { id: 'a', text: '2' },
    ];

    expect(mergeBookmarks({}, incoming, now).a).toEqual({
      id: 'a',
      text: '2',
      fetchedAt: now,
    });
  });

  it('stores reserved ids as enumerable own properties', () => {
    const merged = mergeBookmarks({}, [{ id: '__proto__', text: 'reserved' }], now);
    const bookmark = { id: '__proto__', text: 'reserved', fetchedAt: now };

    expect(Object.getPrototypeOf(merged)).toBeNull();
    expect(Object.keys(merged)).toEqual(['__proto__']);
    expect(Object.values(merged)).toEqual([bookmark]);
    expect(merged.__proto__).toEqual(bookmark);
  });

  it('uses the current time when now is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      expect(mergeBookmarks({}, [{ id: 'a' }]).a.fetchedAt).toBe(now);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate existing or incoming bookmarks', () => {
    const existingBookmark = Object.freeze({ id: 'a', text: 'old', local: true });
    const incomingBookmark = Object.freeze({ id: 'a', text: 'new' });
    const existing = Object.freeze({ a: existingBookmark });
    const incoming = Object.freeze([incomingBookmark]);

    const merged = mergeBookmarks(existing, incoming, now);

    expect(existing).toEqual({ a: { id: 'a', text: 'old', local: true } });
    expect(incoming).toEqual([{ id: 'a', text: 'new' }]);
    expect(merged.a).toEqual({ id: 'a', text: 'new', local: true, fetchedAt: now });
  });
});
