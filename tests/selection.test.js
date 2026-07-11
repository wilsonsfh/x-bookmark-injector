import { describe, it, expect } from 'vitest';
import { pickBookmark } from '../src/core/selection.js';

const bm = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
const first = () => 0; // rng stub -> picks pool[0]

describe('pickBookmark', () => {
  it('never returns a done item', () => {
    const cleared = { a: { action: 'done' } };
    const got = pickBookmark(bm, cleared, { rng: first });
    expect(got.id).not.toBe('a');
  });

  it('never returns an item whose delete outcome is reconciling', () => {
    const cleared = {
      a: { action: 'reconciliation' },
      b: { action: 'done' },
      c: { action: 'done' },
    };
    expect(pickBookmark(bm, cleared, { rng: first })).toBeNull();
  });

  it('excludes keep within cooldown', () => {
    const now = '2026-07-10T12:00:00Z';
    const cleared = {
      a: { action: 'keep', at: '2026-07-10T11:00:00Z' }, // 1h ago < 72h
      b: { action: 'keep', at: '2026-07-10T11:00:00Z' },
    };
    expect(pickBookmark(bm, cleared, { now, cooldownHours: 72, rng: first }).id).toBe('c');
  });

  it('includes keep after cooldown expires', () => {
    const now = '2026-07-20T12:00:00Z';
    const cleared = { a: { action: 'keep', at: '2026-07-10T11:00:00Z' } }; // >72h
    expect(pickBookmark(bm, cleared, { now, cooldownHours: 72, rng: first }).id).toBe('a');
  });

  it('falls back to non-done when all are cooled down', () => {
    const now = '2026-07-10T12:00:00Z';
    const cleared = {
      a: { action: 'keep', at: now },
      b: { action: 'keep', at: now },
      c: { action: 'keep', at: now },
    };
    expect(pickBookmark(bm, cleared, { now, rng: first }).id).toBe('a');
  });

  it('returns null when all done', () => {
    const cleared = {
      a: { action: 'done' },
      b: { action: 'done' },
      c: { action: 'done' },
    };
    expect(pickBookmark(bm, cleared, { rng: first })).toBeNull();
  });
});
