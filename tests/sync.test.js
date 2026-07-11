import { describe, expect, it, vi } from 'vitest';
import { collectBookmarkPages } from '../src/sync.js';

describe('collectBookmarkPages', () => {
  it('follows cursors and preserves newest-first order', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'new' }], nextCursor: 'C2' })
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'old' }], nextCursor: null });

    await expect(collectBookmarkPages(fetchPage)).resolves.toEqual([
      { rest_id: 'new' },
      { rest_id: 'old' },
    ]);
    expect(fetchPage.mock.calls).toEqual([[null], ['C2']]);
  });

  it('stops a repeated-cursor loop', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ tweets: [{ rest_id: 'a' }], nextCursor: 'SAME' });

    await expect(collectBookmarkPages(fetchPage)).rejects.toThrow('cursor repeated');
  });

  it('enforces a hard page cap', async () => {
    const fetchPage = vi.fn(async (cursor) => ({ tweets: [], nextCursor: `${cursor ?? ''}x` }));

    await expect(collectBookmarkPages(fetchPage, { maxPages: 2 })).rejects.toThrow('page limit');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    null,
    {},
    { tweets: null, nextCursor: null },
    { tweets: [], nextCursor: 42 },
  ])('fails closed for a malformed page response: %j', async (page) => {
    await expect(collectBookmarkPages(vi.fn().mockResolvedValue(page)))
      .rejects.toThrow('response invalid');
  });
});
