import { describe, it, expect } from 'vitest';
import { countLeft } from '../src/core/count.js';

describe('countLeft', () => {
  const bookmarks = { a: {}, b: {}, c: {} };
  it('subtracts only done items; keep still counts', () => {
    const cleared = { a: { action: 'done' }, b: { action: 'keep' } };
    expect(countLeft(bookmarks, cleared)).toBe(2); // b (keep) + c
  });
  it('returns total when nothing cleared', () => {
    expect(countLeft(bookmarks, {})).toBe(3);
  });
});
