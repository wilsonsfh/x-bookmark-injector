import { describe, it, expect } from 'vitest';
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
    const merged = mergeBookmarks({}, [{ id: 'a', text: '1' }, { id: 'a', text: '2' }], now);
    expect(merged.a.text).toBe('2');
  });
});
