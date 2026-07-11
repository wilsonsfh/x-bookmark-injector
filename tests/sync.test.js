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

  it('stops a repeated-cursor loop that still returns new tweets', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'a' }], nextCursor: 'SAME' })
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'b' }], nextCursor: 'SAME' });

    await expect(collectBookmarkPages(fetchPage)).rejects.toThrow('cursor repeated');
  });

  it('treats a repeated cursor with no new tweet IDs as a terminal page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'a' }], nextCursor: 'SAME' })
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'a' }], nextCursor: 'SAME' });

    await expect(collectBookmarkPages(fetchPage)).resolves.toEqual([{ rest_id: 'a' }]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('enforces a hard page cap', async () => {
    const fetchPage = vi.fn(async (cursor) => ({ tweets: [], nextCursor: `${cursor ?? ''}x` }));

    await expect(collectBookmarkPages(fetchPage, { maxPages: 2 })).rejects.toThrow('page limit');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially for 429 responses and stops after three attempts', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), { status: 429 });
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'ok' }], nextCursor: null });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(collectBookmarkPages(fetchPage, { sleep })).resolves.toEqual([{ rest_id: 'ok' }]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);

    fetchPage.mockClear();
    sleep.mockClear();
    fetchPage.mockRejectedValue(rateLimited);
    await expect(collectBookmarkPages(fetchPage, { sleep })).rejects.toBe(rateLimited);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it.each([Infinity, 0, 1.5, 101])('rejects invalid maxPages value %s before fetching', async (maxPages) => {
    const fetchPage = vi.fn();

    await expect(collectBookmarkPages(fetchPage, { maxPages })).rejects.toThrow('maxPages');
    expect(fetchPage).not.toHaveBeenCalled();
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
