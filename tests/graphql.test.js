import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBookmarksRequest, buildMutationRequest, parseBookmarks } from '../src/x-api/graphql.js';

const fixture = JSON.parse(readFileSync('fixtures/bookmarks-response.json', 'utf8'));
const auth = {
  bearer: 'Bearer captured',
  csrf: 'csrf-token',
  queryIds: { Bookmarks: 'read123', DeleteBookmark: 'del123', CreateBookmark: 'create123' },
  operationHeaders: { Bookmarks: { 'x-client-transaction-id': 'captured-tx' } },
  operationTemplates: {
    Bookmarks: { params: { features: '{"captured":true}' } },
    DeleteBookmark: { body: { features: { captured: true }, variables: { dark_request: false } } },
  },
};

describe('X GraphQL requests', () => {
  it('builds an authenticated Bookmarks GET with optional cursor', () => {
    const { url, init } = buildBookmarksRequest(auth, 'CURSOR');
    expect(url).toContain('/i/api/graphql/read123/Bookmarks?');
    expect(JSON.parse(new URL(url).searchParams.get('variables'))).toMatchObject({ count: 100, cursor: 'CURSOR' });
    expect(new URL(url).searchParams.get('features')).toBe('{"captured":true}');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(init.headers).toMatchObject({
      authorization: 'Bearer captured',
      'x-csrf-token': 'csrf-token',
      'x-client-transaction-id': 'captured-tx',
    });
  });

  it('preserves captured Bookmarks variables while replacing the cursor', () => {
    const capturedAuth = structuredClone(auth);
    capturedAuth.operationTemplates.Bookmarks.params.variables = JSON.stringify({
      count: 20,
      includePromotedContent: true,
      cursor: 'OLD_CURSOR',
      captured_variable: 'keep-me',
    });

    const { url } = buildBookmarksRequest(capturedAuth, 'NEW_CURSOR');
    expect(JSON.parse(new URL(url).searchParams.get('variables'))).toEqual({
      count: 20,
      includePromotedContent: true,
      cursor: 'NEW_CURSOR',
      captured_variable: 'keep-me',
    });
    expect(JSON.parse(capturedAuth.operationTemplates.Bookmarks.params.variables).cursor).toBe('OLD_CURSOR');
  });

  it('normalizes captured headers and strips captured credentials and cookies', () => {
    const capturedAuth = structuredClone(auth);
    capturedAuth.operationHeaders.Bookmarks = {
      Authorization: 'Bearer stale',
      'X-CSRF-Token': 'stale-csrf',
      Cookie: 'auth_token=stale',
      'Set-Cookie': 'auth_token=stale',
      'X-Client-Transaction-ID': 'captured-tx',
    };

    const { init } = buildBookmarksRequest(capturedAuth);
    expect(init.headers).toMatchObject({
      authorization: 'Bearer captured',
      'x-csrf-token': 'csrf-token',
      'x-client-transaction-id': 'captured-tx',
    });
    expect(Object.keys(init.headers).every((name) => name === name.toLowerCase())).toBe(true);
    expect(init.headers).not.toHaveProperty('cookie');
    expect(init.headers).not.toHaveProperty('set-cookie');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('builds DeleteBookmark POST without changing the captured template', () => {
    const { url, init } = buildMutationRequest('DeleteBookmark', auth, '1806');
    expect(url).toBe('https://x.com/i/api/graphql/del123/DeleteBookmark');
    expect(JSON.parse(init.body)).toEqual({
      features: { captured: true },
      variables: { dark_request: false, tweet_id: '1806' },
      queryId: 'del123',
    });
    expect(auth.operationTemplates.DeleteBookmark.body.variables).toEqual({ dark_request: false });
  });

  it('builds CreateBookmark POST without changing the captured template', () => {
    const capturedAuth = structuredClone(auth);
    capturedAuth.operationTemplates.CreateBookmark = {
      body: {
        features: { captured_create: true },
        variables: { dark_request: false, captured_variable: 'keep-me' },
      },
    };

    const { url, init } = buildMutationRequest('CreateBookmark', capturedAuth, '1806');
    expect(url).toBe('https://x.com/i/api/graphql/create123/CreateBookmark');
    expect(JSON.parse(init.body)).toEqual({
      features: { captured_create: true },
      variables: { dark_request: false, captured_variable: 'keep-me', tweet_id: '1806' },
      queryId: 'create123',
    });
    expect(capturedAuth.operationTemplates.CreateBookmark.body.variables).toEqual({
      dark_request: false,
      captured_variable: 'keep-me',
    });
  });

  it.each([undefined, '', '   '])('rejects non-present tweet ID %j', (tweetId) => {
    expect(() => buildMutationRequest('DeleteBookmark', auth, tweetId)).toThrow('Tweet ID required');
  });

  it('rejects incomplete auth', () => {
    expect(() => buildBookmarksRequest({ ...auth, bearer: '' })).toThrow('X auth capture incomplete');
  });

  it('rejects unsupported mutations', () => {
    expect(() => buildMutationRequest('Unknown', auth, '1806')).toThrow('Unsupported mutation: Unknown');
  });
});

describe('parseBookmarks', () => {
  it('parses v2 tweet results and bottom cursor', () => {
    const parsed = parseBookmarks(fixture);
    expect(parsed.tweets).toHaveLength(1);
    expect(parsed.tweets[0].rest_id).toBe('1806');
    expect(parsed.nextCursor).toBe('NEXT_CURSOR');
  });

  it('parses legacy timeline module items and wrapped tweets', () => {
    const payload = {
      data: {
        bookmark_timeline: {
          timeline: {
            instructions: [{
              type: 'TimelineAddEntries',
              entries: [{
                entryId: 'module-legacy',
                content: {
                  items: [{
                    item: {
                      itemContent: {
                        tweet_results: { result: { tweet: { rest_id: 'legacy-1' } } },
                      },
                    },
                  }],
                },
              }],
            }],
          },
        },
      },
    };

    expect(parseBookmarks(payload)).toEqual({
      tweets: [{ rest_id: 'legacy-1' }],
      nextCursor: null,
    });
  });

  it('throws a sanitized integration error for GraphQL error-only payloads', () => {
    const payload = { errors: [{ message: 'secret upstream detail' }] };

    expect(() => parseBookmarks(payload)).toThrowError(new Error('X bookmarks integration response invalid'));
  });

  it('throws a sanitized integration error when the timeline is absent', () => {
    expect(() => parseBookmarks({ data: {} })).toThrowError(new Error('X bookmarks integration response invalid'));
  });

  it('ignores validated non-tweet cursor and empty module entries', () => {
    const payload = {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [{
              type: 'TimelineAddEntries',
              entries: [
                { entryId: 'cursor-top-0', content: { cursorType: 'Top', value: 'TOP' } },
                { entryId: 'module-empty-0', content: { items: [] } },
              ],
            }],
          },
        },
      },
    };

    expect(parseBookmarks(payload)).toEqual({ tweets: [], nextCursor: null });
  });

  it.each([
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{}] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'Unknown', entries: [] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: {} }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [null] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'unknown-0', content: {} }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'cursor-bottom-0', content: { cursorType: 'Bottom' } }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'cursor-new-0', content: { cursorType: 'NewCursorType', value: 'CURSOR' } }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'module-bad-0', content: { items: {} } }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'tweet-1', content: { itemContent: {} } }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'tweet-1', content: { itemContent: { tweet_results: {} } } }] }] } } } }],
    [{ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: { legacy: {} } } } } }] }] } } } }],
    [{ errors: [{ message: 'partial failure' }], ...fixture }],
  ])('rejects malformed or unrecognized bookmark schema %#', (payload) => {
    expect(() => parseBookmarks(payload)).toThrowError(new Error('X bookmarks integration response invalid'));
  });

  it('rejects a malformed intended tweet inside a module', () => {
    const payload = {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [{
              type: 'TimelineAddEntries',
              entries: [{
                entryId: 'module-tweets-0',
                content: {
                  items: [{
                    entryId: 'tweet-1',
                    item: { itemContent: { tweet_results: { result: { legacy: {} } } } },
                  }],
                },
              }],
            }],
          },
        },
      },
    };

    expect(() => parseBookmarks(payload)).toThrowError(new Error('X bookmarks integration response invalid'));
  });
});
